import { Connection, PublicKey } from '@solana/web3.js'
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { classifyBox } from './classify-box'
import { canRefundExcess, refundWorthIt } from './excess'
import { lamportsToSol, solToLamports } from './format'
import { ESTIMATED_GAS_SOL } from './programs'
import type { ScanEstimate, ScanResponse, TokenBox } from './types'

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

function blankBox(partial: Pick<TokenBox, 'address' | 'mint' | 'program' | 'amount' | 'decimals' | 'lamports' | 'space' | 'frozen' | 'native' | 'delegate' | 'extensions' | 'kind'>): TokenBox {
  return {
    extraLamports: 0,
    excessLamports: 0,
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
    ...partial,
  }
}

async function fetchProgramBoxes(connection: Connection, owner: PublicKey, program: 'token' | 'token2022'): Promise<TokenBox[]> {
  const programId = program === 'token' ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID
  const res = await connection.getParsedTokenAccountsByOwner(owner, { programId })
  return res.value.flatMap(({ pubkey, account }) => {
    const info = parseInfo(account.data)
    if (!info) return []
    const amount = BigInt(info.tokenAmount.amount)
    const native = info.isNative === true || (typeof info.isNative === 'object' && !!info.isNative)
    const frozen = info.state === 'frozen'
    const space = typeof (account.data as { space?: number }).space === 'number'
      && (account.data as { space: number }).space > 0
      ? (account.data as { space: number }).space
      : 165
    return [blankBox({
      address: pubkey.toBase58(),
      mint: info.mint,
      program,
      amount: info.tokenAmount.amount,
      decimals: info.tokenAmount.decimals,
      lamports: account.lamports,
      space,
      frozen,
      native,
      delegate: info.delegate || '',
      extensions: extensionNames(info),
      kind: classifyBox({
        amount,
        decimals: info.tokenAmount.decimals,
        frozen,
        native,
        mint: info.mint,
      }),
    })]
  })
}

async function attachExcess(connection: Connection, boxes: TokenBox[]): Promise<void> {
  const spaces = [...new Set(boxes.map((b) => b.space || 165))]
  const rents = await Promise.all(spaces.map(async (space) => [space, await connection.getMinimumBalanceForRentExemption(space)] as const))
  const bySpace = new Map(rents)
  for (const box of boxes) {
    const min = bySpace.get(box.space || 165) ?? 0
    box.excessLamports = Math.max(0, box.lamports - min)
  }
}

function toEstimate(address: string, boxes: TokenBox[], sol: number, rentNow: number, minFeePayer: number): ScanEstimate {
  const empty = boxes.filter((b) => b.kind === 'empty' && !b.frozen)
  const dust = boxes.filter((b) => b.kind === 'dust')
  const nft = boxes.filter((b) => b.kind === 'nft')
  const frozen = boxes.filter((b) => b.kind === 'frozen' || (b.kind === 'empty' && b.frozen))
  const keep = boxes.filter((b) => b.kind === 'keep')
  const stayOpen = boxes.filter((b) => b.kind !== 'empty' && canRefundExcess(b))
  const emptyLamports = empty.reduce((s, b) => s + b.lamports, 0)
  const dustLamports = dust.reduce((s, b) => s + b.lamports, 0)
  const nftLamports = nft.reduce((s, b) => s + b.lamports, 0)
  const excessLamports = stayOpen.reduce((s, b) => s + b.excessLamports, 0)
  const excessOk = refundWorthIt(excessLamports, stayOpen.length)
  return {
    addr: address,
    empty: empty.length,
    dust: dust.length,
    nft: nft.length,
    frozen: frozen.length,
    keep: keep.length,
    rent: lamportsToSol(rentNow),
    dustValue: 0,
    noSol: sol < minFeePayer,
    sol: lamportsToSol(sol),
    emptySol: lamportsToSol(emptyLamports),
    dustSol: lamportsToSol(dustLamports),
    nftSol: lamportsToSol(nftLamports),
    solUsd: 0,
    sweep: 0,
    excess: excessOk ? stayOpen.length : 0,
    excessSol: excessOk ? lamportsToSol(excessLamports) : 0,
  }
}

/** Structural scan against a caller-supplied RPC. No prices, no Grabster backend. */
export async function scanLocal(connection: Connection, address: string): Promise<ScanResponse> {
  const owner = new PublicKey(address)
  const [token, token2022, sol, rentLamports, systemRent] = await Promise.all([
    fetchProgramBoxes(connection, owner, 'token'),
    fetchProgramBoxes(connection, owner, 'token2022'),
    connection.getBalance(owner),
    connection.getMinimumBalanceForRentExemption(165),
    connection.getMinimumBalanceForRentExemption(0),
  ])
  const boxes = [...token, ...token2022]
  await attachExcess(connection, boxes)
  const minFeePayer = systemRent + solToLamports(ESTIMATED_GAS_SOL)
  return {
    address: owner.toBase58(),
    estimate: toEstimate(owner.toBase58(), boxes, sol, rentLamports, minFeePayer),
    boxes,
    rentNow: lamportsToSol(rentLamports),
  }
}
