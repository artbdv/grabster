import { PublicKey } from '@solana/web3.js'
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  canRefundExcess,
  classifyBox,
  ESTIMATED_GAS_SOL,
  refundWorthIt,
  editionPda,
  isSweepableBox,
  lamportsToSol,
  isPnftStandard,
  metadataPda,
  parseNftMetadata,
  solToLamports,
  TOKEN_STANDARD_PNFT_EDITION,
  tokenRecordPda,
  type BatchScanRow,
  type ScanEstimate,
  type ScanResponse,
  type TokenBox,
} from '@grabster/solana-core'
import { enrichBoxes } from '../../shared/jupiter'
import { rpc, withRpc } from '../../shared/rpc'
import { rentFor, tokenAccountRent } from '../../shared/rent'
import { isListedMint, rememberLiquidMints } from '../../shared/sink-allow'
import { attachTransferFees } from '../../shared/transfer-fee'

type ParsedInfo = {
  mint: string
  tokenAmount: { amount: string; decimals: number }
  state: string
  isNative: boolean | { amount?: string }
  delegate?: string
  extensions?: Array<string | { extension?: string }>
}

function extensionNames(info: ParsedInfo): string[] {
  const raw = info.extensions
  if (!Array.isArray(raw)) return []
  const names = raw.map((item) => (typeof item === 'string' ? item : item?.extension || '')).filter(Boolean)
  return [...new Set(names)]
}

function parseInfo(raw: unknown): ParsedInfo | null {
  const info = (raw as { parsed?: { info?: ParsedInfo } } | undefined)?.parsed?.info
  if (!info?.mint || !info.tokenAmount) return null
  return info
}

async function fetchProgramBoxes(owner: PublicKey, program: 'token' | 'token2022'): Promise<TokenBox[]> {
  const programId = program === 'token' ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID
  const res = await rpc().getParsedTokenAccountsByOwner(owner, { programId })
  return res.value.flatMap(({ pubkey, account }) => {
    const info = parseInfo(account.data)
    if (!info) return []
    const amount = BigInt(info.tokenAmount.amount)
    const native = info.isNative === true || (typeof info.isNative === 'object' && !!info.isNative)
    const frozen = info.state === 'frozen'
    const kind = classifyBox({
      amount,
      decimals: info.tokenAmount.decimals,
      frozen,
      native,
      mint: info.mint,
    })
    const space = typeof (account.data as { space?: number }).space === 'number'
      && (account.data as { space: number }).space > 0
      ? (account.data as { space: number }).space
      : 165
    return [{
      address: pubkey.toBase58(),
      mint: info.mint,
      program,
      amount: info.tokenAmount.amount,
      decimals: info.tokenAmount.decimals,
      lamports: account.lamports,
      extraLamports: 0,
      space,
      excessLamports: 0,
      frozen,
      native,
      delegate: info.delegate || '',
      extensions: extensionNames(info),
      symbol: '',
      logo: '',
      usdPrice: 0,
      valueUsd: 0,
      liquidityUsd: 0,
      hasPrice: false,
      listed: false,
      netValueUsd: 0,
      transferFeeBps: 0,
      sweepable: false,
      collection: '',
      collectionVerified: false,
      nftBurnable: false,
      tokenStandard: null,
      ruleSet: '',
      kind,
    }]
  })
}

async function attachNftExtras(boxes: TokenBox[]): Promise<void> {
  const nfts = boxes.filter((b) => b.kind === 'nft')
  if (!nfts.length) return
  const keys: PublicKey[] = []
  for (const box of nfts) {
    const mint = new PublicKey(box.mint)
    keys.push(metadataPda(mint), editionPda(mint))
  }
  const infos: Array<{ lamports: number; data: Buffer } | null> = []
  for (let i = 0; i < keys.length; i += 100) {
    infos.push(...await rpc().getMultipleAccountsInfo(keys.slice(i, i + 100)))
  }
  const records: PublicKey[] = []
  const recordAt: number[] = []
  nfts.forEach((box, i) => {
    const meta = infos[i * 2]
    const edition = infos[i * 2 + 1]
    box.extraLamports = (meta?.lamports ?? 0) + (edition?.lamports ?? 0)
    const parsed = meta?.data
      ? parseNftMetadata(meta.data)
      : { collection: '', collectionVerified: false, tokenStandard: null, ruleSet: '' }
    box.collection = parsed.collection
    box.collectionVerified = parsed.collectionVerified
    box.tokenStandard = parsed.tokenStandard
    box.ruleSet = parsed.ruleSet
    const pnft = isPnftStandard(parsed.tokenStandard)
    const classic = parsed.tokenStandard == null || parsed.tokenStandard === 0
    const editionOk = parsed.tokenStandard !== TOKEN_STANDARD_PNFT_EDITION
    const burnable = Boolean(edition && (classic || pnft) && editionOk && !box.delegate)
    if (box.frozen && !pnft) {
      box.kind = 'frozen'
      box.nftBurnable = false
      return
    }
    if (parsed.collectionVerified || !burnable) {
      box.kind = 'keep'
      box.nftBurnable = false
      return
    }
    box.nftBurnable = true
    if (pnft) {
      recordAt.push(i)
      records.push(tokenRecordPda(new PublicKey(box.mint), new PublicKey(box.address)))
    }
  })
  if (!records.length) return
  const recInfos: Array<{ lamports: number } | null> = []
  for (let i = 0; i < records.length; i += 100) {
    recInfos.push(...await rpc().getMultipleAccountsInfo(records.slice(i, i + 100)))
  }
  recInfos.forEach((rec, j) => {
    const box = nfts[recordAt[j]]
    if (!box) return
    if (!rec) {
      box.kind = 'keep'
      box.nftBurnable = false
      return
    }
    box.extraLamports += rec.lamports
  })
}

async function attachExcess(boxes: TokenBox[]): Promise<void> {
  const spaces = [...new Set(boxes.map((b) => b.space || 165))]
  const rents = await Promise.all(spaces.map(async (space) => [space, await rentFor(space)] as const))
  const bySpace = new Map(rents)
  for (const box of boxes) {
    const min = bySpace.get(box.space || 165) ?? 0
    box.excessLamports = Math.max(0, box.lamports - min)
  }
}

export const SCAN_BATCH_MAX = 100
const SCAN_CONCURRENCY = 8

function blankEstimate(addr: string): ScanEstimate {
  return {
    addr, empty: 0, dust: 0, nft: 0, frozen: 0, keep: 0,
    rent: 0, dustValue: 0, noSol: false, sol: 0, emptySol: 0, dustSol: 0, nftSol: 0, solUsd: 0, sweep: 0, excess: 0, excessSol: 0,
  }
}

async function mapPool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) || 1 }, () => worker()))
  return out
}

async function loadOwner(address: string): Promise<{ address: string; boxes: TokenBox[]; sol: number }> {
  const owner = new PublicKey(address)
  const [token, token2022, sol] = await Promise.all([
    fetchProgramBoxes(owner, 'token'),
    fetchProgramBoxes(owner, 'token2022'),
    rpc().getBalance(owner),
  ])
  return { address: owner.toBase58(), boxes: [...token, ...token2022], sol }
}

async function finishBoxes(boxes: TokenBox[]): Promise<number> {
  await attachNftExtras(boxes)
  await attachExcess(boxes)
  const solUsd = await enrichBoxes(boxes)
  await attachTransferFees(boxes)
  await rememberLiquidMints(boxes)
  for (const box of boxes) {
    box.listed = isListedMint(box.mint)
    box.sweepable = isSweepableBox(box)
  }
  return solUsd
}

function toEstimate(
  address: string,
  boxes: TokenBox[],
  sol: number,
  rentNow: number,
  solUsd: number,
  minFeePayer: number,
): ScanEstimate {
  const empty = boxes.filter((b) => b.kind === 'empty')
  const dust = boxes.filter((b) => b.kind === 'dust')
  const nft = boxes.filter((b) => b.kind === 'nft')
  const frozen = boxes.filter((b) => b.kind === 'frozen')
  const keep = boxes.filter((b) => b.kind === 'keep')
  const sweep = dust.filter((b) => b.sweepable)
  const stayOpen = boxes.filter((b) => {
    if (b.kind === 'empty') return false
    if (b.kind === 'nft' && b.nftBurnable) return false
    return canRefundExcess(b)
  })
  const emptyLamports = empty.reduce((s, b) => s + b.lamports, 0)
  const dustLamports = dust.reduce((s, b) => s + b.lamports, 0)
  const nftLamports = nft.reduce((s, b) => s + b.lamports + b.extraLamports, 0)
  const excessLamports = stayOpen.reduce((s, b) => s + b.excessLamports, 0)
  const excessOk = refundWorthIt(excessLamports, stayOpen.length)
  const dustValueUsd = dust.reduce((s, b) => s + b.valueUsd, 0)
  return {
    addr: address,
    empty: empty.length,
    dust: dust.length,
    nft: nft.length,
    frozen: frozen.length,
    keep: keep.length,
    rent: lamportsToSol(rentNow),
    dustValue: solUsd > 0 ? dustValueUsd / solUsd : 0,
    noSol: sol < minFeePayer,
    sol: lamportsToSol(sol),
    emptySol: lamportsToSol(emptyLamports),
    dustSol: lamportsToSol(dustLamports),
    nftSol: lamportsToSol(nftLamports),
    solUsd,
    sweep: sweep.length,
    excess: excessOk ? stayOpen.length : 0,
    excessSol: excessOk ? lamportsToSol(excessLamports) : 0,
  }
}

export async function scanAddress(address: string): Promise<ScanResponse> {
  return withRpc(() => scanAddressOnce(address))
}

async function scanAddressOnce(address: string): Promise<ScanResponse> {
  const [loaded, rentNow, systemRent] = await Promise.all([
    loadOwner(address),
    tokenAccountRent(),
    rentFor(0),
  ])
  const solUsd = await finishBoxes(loaded.boxes)
  const minFeePayer = systemRent + solToLamports(ESTIMATED_GAS_SOL)
  return {
    address: loaded.address,
    estimate: toEstimate(loaded.address, loaded.boxes, loaded.sol, rentNow, solUsd, minFeePayer),
    boxes: loaded.boxes,
    rentNow: lamportsToSol(rentNow),
  }
}

export async function scanAddresses(addresses: string[]): Promise<BatchScanRow[]> {
  const jobs: { raw: string; address: string; error?: string }[] = []
  const seen = new Set<string>()
  for (const raw of addresses) {
    const trimmed = String(raw || '').trim()
    try {
      const address = new PublicKey(trimmed).toBase58()
      if (seen.has(address)) continue
      seen.add(address)
      jobs.push({ raw: trimmed, address })
    } catch {
      if (seen.has(trimmed)) continue
      seen.add(trimmed)
      jobs.push({ raw: trimmed, address: trimmed, error: 'Invalid Solana address.' })
    }
  }

  const [rentNow, systemRent] = await Promise.all([
    withRpc(() => tokenAccountRent()),
    withRpc(() => rentFor(0)),
  ])
  const minFeePayer = systemRent + solToLamports(ESTIMATED_GAS_SOL)
  const loaded = await mapPool(jobs, SCAN_CONCURRENCY, async (job) => {
    if (job.error) return { job, owner: null as Awaited<ReturnType<typeof loadOwner>> | null }
    try {
      return { job, owner: await withRpc(() => loadOwner(job.address)) }
    } catch (e) {
      return {
        job: { ...job, error: e instanceof Error ? e.message : 'Could not read that wallet.' },
        owner: null,
      }
    }
  })

  const ok = loaded.filter((row) => row.owner)
  const allBoxes = ok.flatMap((row) => row.owner!.boxes)
  const solUsd = allBoxes.length ? await withRpc(() => finishBoxes(allBoxes)) : 0

  return loaded.map(({ job, owner }) => {
    if (job.error || !owner) {
      return { address: job.address, estimate: blankEstimate(job.address), error: job.error || 'Could not read that wallet.' }
    }
    return {
      address: owner.address,
      estimate: toEstimate(owner.address, owner.boxes, owner.sol, rentNow, solUsd, minFeePayer),
    }
  })
}
