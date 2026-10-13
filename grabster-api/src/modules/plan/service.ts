import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createBurnCheckedInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  createTransferCheckedWithFeeAndTransferHookInstruction,
  createTransferCheckedWithTransferHookInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import {
  ataCreateJustified,
  burnNftInstruction,
  burnV1Instruction,
  canRefundExcess,
  editionPda,
  isPnftStandard,
  ESTIMATED_GAS_SOL,
  hasTransferHook,
  isSweepableBox,
  metadataPda,
  tokenRecordPda,
  NFT_PER_BATCH,
  REFUND_PER_BATCH,
  refundWorthIt,
  solToLamports,
  sweepCreditSol,
  sweepValueUsd,
  SWEEP_PER_BATCH,
  TX_PER_BATCH,
  withdrawExcessInstruction,
  type Destination,
  type PlannedTx,
  type PlanResponse,
  type TokenBox,
} from '@grabster/solana-core'
import { env } from '../../shared/env'
import { rpc, withRpc } from '../../shared/rpc'
import { listedValueUsd } from '../../shared/sink-allow'
import { buildTx, fits, latestBlockhash, priorityMicroLamports } from '../../shared/tx'
import { rentFor } from '../../shared/rent'
import { scanAddress } from '../scan/service'
import { putPlan } from './store'

function programId(box: TokenBox) {
  return box.program === 'token2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
}

function mintKey(box: TokenBox) {
  return `${box.program}:${box.mint}`
}

function closeIx(box: TokenBox, dest: PublicKey, owner: PublicKey): TransactionInstruction {
  return createCloseAccountInstruction(new PublicKey(box.address), dest, owner, [], programId(box))
}

function burnIx(box: TokenBox, owner: PublicKey): TransactionInstruction {
  return createBurnCheckedInstruction(
    new PublicKey(box.address),
    new PublicKey(box.mint),
    owner,
    BigInt(box.amount),
    box.decimals,
    [],
    programId(box),
  )
}

async function sweepTransferIx(box: TokenBox, sink: PublicKey, owner: PublicKey): Promise<TransactionInstruction | null> {
  const source = new PublicKey(box.address)
  const mint = new PublicKey(box.mint)
  const amount = BigInt(box.amount)
  const pid = programId(box)
  try {
    if (hasTransferHook(box) && box.transferFeeBps > 0) {
      const fee = (amount * BigInt(box.transferFeeBps)) / 10_000n
      return await createTransferCheckedWithFeeAndTransferHookInstruction(
        rpc(), source, mint, sink, owner, amount, box.decimals, fee, [], 'confirmed', pid,
      )
    }
    if (hasTransferHook(box)) {
      return await createTransferCheckedWithTransferHookInstruction(
        rpc(), source, mint, sink, owner, amount, box.decimals, [], 'confirmed', pid,
      )
    }
    return createTransferCheckedInstruction(source, mint, sink, owner, amount, box.decimals, [], pid)
  } catch (err) {
    console.warn('Could not resolve Give accounts for', box.mint, err)
    return null
  }
}

function ataIx(box: TokenBox, sink: PublicKey, treasury: PublicKey): TransactionInstruction {
  return createAssociatedTokenAccountIdempotentInstruction(
    treasury,
    sink,
    treasury,
    new PublicKey(box.mint),
    programId(box),
  )
}

type CloseItem = { kind: 'close'; box: TokenBox }
type BurnItem = { kind: 'burn'; box: TokenBox }
type SweepDraft = {
  kind: 'sweep'
  box: TokenBox
  sink: PublicKey
  needsCreate: boolean
  creditLamports: number
}
type SweepItem = SweepDraft & { transfer: TransactionInstruction }
type NftItem = {
  kind: 'nft'
  box: TokenBox
  metadata: PublicKey
  edition: PublicKey
  collectionMetadata?: PublicKey
  tokenRecord?: PublicKey
  ruleSet?: PublicKey
}
type RefundItem = { kind: 'refund'; box: TokenBox }
type Item = CloseItem | BurnItem | SweepItem | NftItem | RefundItem

function recoveredOf(item: Item): number {
  if (item.kind === 'nft') return item.box.lamports + item.box.extraLamports
  if (item.kind === 'refund') return item.box.excessLamports
  return item.box.lamports
}

function encode(tx: Transaction, type: PlannedTx['type'], extra: PlannedTx['description']): PlannedTx {
  const raw = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
  const messageHash = tx.compileMessage().serialize().toString('base64')
  return {
    id: messageHash.slice(0, 16),
    type,
    tx: raw.toString('base64'),
    messageHash,
    description: extra,
  }
}

function feePct(dest: Destination): number {
  return dest === 'balance' ? env.feeBalance : env.feeDirect
}

function feeOf(recovered: number, dest: Destination): number {
  const pct = feePct(dest)
  if (!env.treasury || pct <= 0) return 0
  return Math.floor((recovered * pct) / 100)
}

function createFlags(batch: Item[], opened: Set<string>): Map<string, boolean> {
  const flags = new Map<string, boolean>()
  const seen = new Set(opened)
  for (const item of batch) {
    if (item.kind !== 'sweep' || !item.needsCreate) continue
    const key = mintKey(item.box)
    if (seen.has(key)) continue
    flags.set(item.box.address, true)
    seen.add(key)
  }
  return flags
}

function batchType(batch: Item[]): PlannedTx['type'] {
  if (batch.some((i) => i.kind === 'nft')) return 'NFT'
  if (batch.some((i) => i.kind === 'sweep')) return 'SWEEP'
  if (batch.some((i) => i.kind === 'burn')) return 'BURN'
  if (batch.some((i) => i.kind === 'refund')) return 'REFUND'
  return 'CLOSE'
}

function maxPerBatch(kind: Item['kind']): number {
  if (kind === 'sweep') return SWEEP_PER_BATCH
  if (kind === 'nft') return NFT_PER_BATCH
  if (kind === 'refund') return REFUND_PER_BATCH
  return TX_PER_BATCH
}

function cuLimitFor(batch: Item[]): number {
  if (batch.some((i) => i.kind === 'nft' && isPnftStandard(i.box.tokenStandard))) {
    return 80_000 + batch.length * 140_000
  }
  if (batch.some((i) => i.kind === 'nft')) return 50_000 + batch.length * 80_000
  if (batch.every((i) => i.kind === 'refund')) return 50_000 + batch.length * 8_000
  if (batch.some((i) => i.kind === 'sweep' && hasTransferHook(i.box))) {
    return 80_000 + batch.length * 80_000
  }
  const heavy = batch.some((i) => i.kind === 'sweep' || i.kind === 'burn')
  return 50_000 + batch.length * (heavy ? 40_000 : 12_000)
}

export async function buildPlan(input: {
  address: string
  dest: Destination
  other?: string
  burnDust: boolean
  burnAccounts?: string[]
  sweepAccounts?: string[]
  burnNft: boolean
  nftAccounts?: string[]
  refundExcess?: boolean
  refundAccounts?: string[]
}): Promise<PlanResponse> {
  if (input.dest === 'balance') {
    if (!env.features.balance || !env.treasury) {
      throw Object.assign(new Error('Grabster balance is not enabled yet.'), { status: 400 })
    }
  }
  if (input.dest === 'other') {
    try {
      new PublicKey(input.other || '')
    } catch {
      throw Object.assign(new Error('Recipient address is invalid.'), { status: 400 })
    }
  }
  if (input.burnDust && input.sweepAccounts?.length) {
    throw Object.assign(new Error('Choose burn or give, not both.'), { status: 400 })
  }
  if (input.sweepAccounts?.length) {
    if (!env.features.sweep || !env.treasury || !env.treasurySecret) {
      throw Object.assign(new Error('Giving leftovers is not enabled.'), { status: 400 })
    }
  }

  const owner = new PublicKey(input.address)
  if (input.other && new PublicKey(input.other).equals(owner) === false) {
    if (env.treasury && input.other === env.treasury) {
      throw Object.assign(new Error('Destination cannot be the treasury.'), { status: 400 })
    }
  }

  const scan = await scanAddress(input.address)
  const closable = scan.boxes.filter((b) => b.kind === 'empty')
  const allowBurn = input.burnAccounts ? new Set(input.burnAccounts) : null
  const burns = input.burnDust
    ? scan.boxes.filter((b) => b.kind === 'dust' && !b.native && (!allowBurn || allowBurn.has(b.address)))
    : []
  if (input.burnNft && !env.features.nftBurn) {
    throw Object.assign(new Error('NFT burn is not enabled.'), { status: 400 })
  }
  const allowNft = input.nftAccounts ? new Set(input.nftAccounts) : null
  const nftBoxes = input.burnNft
    ? scan.boxes.filter((b) => b.kind === 'nft' && b.nftBurnable && (!allowNft || allowNft.has(b.address)))
    : []
  const nftItems: NftItem[] = nftBoxes.map((box) => {
    const mint = new PublicKey(box.mint)
    const token = new PublicKey(box.address)
    return {
      kind: 'nft' as const,
      box,
      metadata: metadataPda(mint),
      edition: editionPda(mint),
      collectionMetadata: undefined,
      tokenRecord: isPnftStandard(box.tokenStandard) ? tokenRecordPda(mint, token) : undefined,
      ruleSet: box.ruleSet ? new PublicKey(box.ruleSet) : undefined,
    }
  })

  const treasury = env.treasury ? new PublicKey(env.treasury) : null
  const wantSweep = [...new Set(input.sweepAccounts || [])]
  const sweepBoxes = wantSweep.length
    ? scan.boxes.filter((b) => wantSweep.includes(b.address) && isSweepableBox(b))
    : []
  const sweepPicked = treasury ? await pickSweeps(sweepBoxes, treasury, scan.rentNow, scan.estimate.solUsd) : []
  const sweepItems: SweepItem[] = []
  for (const item of sweepPicked) {
    const transfer = await sweepTransferIx(item.box, item.sink, owner)
    if (!transfer) continue
    sweepItems.push({ ...item, transfer })
  }

  if (input.refundExcess && !env.features.excessRent) {
    throw Object.assign(new Error('Extra-deposit refund is not enabled.'), { status: 400 })
  }
  const closing = new Set([
    ...closable.map((b) => b.address),
    ...burns.map((b) => b.address),
    ...sweepItems.map((i) => i.box.address),
    ...nftBoxes.map((b) => b.address),
  ])
  const allowRefund = input.refundAccounts ? new Set(input.refundAccounts) : null
  const refundCandidates = input.refundExcess
    ? scan.boxes.filter((b) => canRefundExcess(b) && !closing.has(b.address) && (!allowRefund || allowRefund.has(b.address)))
    : []
  const refundLamports = refundCandidates.reduce((s, b) => s + b.excessLamports, 0)
  const refundItems: RefundItem[] = refundWorthIt(refundLamports, refundCandidates.length)
    ? refundCandidates.map((box) => ({ kind: 'refund' as const, box }))
    : []

  if (!closable.length && !burns.length && !sweepItems.length && !nftItems.length && !refundItems.length) {
    throw Object.assign(new Error('Nothing to grab.'), { status: 400 })
  }

  const closeDest = owner
  const remainderTo = input.dest === 'other'
    ? new PublicKey(input.other!)
    : input.dest === 'balance' && treasury
      ? treasury
      : null
  const [sol, systemRent] = await Promise.all([
    withRpc(() => rpc().getBalance(owner)),
    rentFor(0),
  ])
  const gasLamports = solToLamports(ESTIMATED_GAS_SOL)
  const reserve = systemRent + gasLamports
  const needsTreasurySig = Boolean(
    env.treasurySecret && treasury && (sweepItems.length > 0 || sol < reserve),
  )
  if (!needsTreasurySig && sol < reserve) {
    throw Object.assign(new Error('Not enough SOL to pay network fees.'), { status: 400 })
  }
  const feePayer = needsTreasurySig && sol < reserve ? treasury! : owner
  const ownerPays = feePayer.equals(owner)
  let ownerLamports = sol

  if (sweepItems.length && treasury) {
    await assertTreasuryCanSweep(treasury, sweepItems, scan.rentNow, reserve)
  }

  const blockhash = await latestBlockhash()
  const cuPrice = await priorityMicroLamports()
  const planned: PlannedTx[] = []
  const openedSinks = new Set<string>()

  const payout = (recovered: number, wallet: number) => {
    const floor = ownerPays ? reserve : systemRent
    let withheld = feeOf(recovered, input.dest)
    if (needsTreasurySig && feePayer.equals(treasury!)) withheld += solToLamports(ESTIMATED_GAS_SOL * 2)
    if (withheld > recovered) withheld = recovered
    let leftover = recovered - withheld
    const after = (w: number, l: number) => wallet + recovered - w - (remainderTo ? l : 0)
    if (remainderTo) {
      leftover = Math.min(leftover, Math.max(0, after(withheld, 0) - floor))
    }
    if (after(withheld, leftover) < floor) {
      withheld = Math.min(withheld, Math.max(0, wallet + recovered - (remainderTo ? leftover : 0) - floor))
      if (!remainderTo) leftover = recovered - withheld
    }
    return { withheld: Math.max(0, withheld), leftover: Math.max(0, leftover) }
  }

  const settle = (batch: Item[]) => {
    const recovered = batch.reduce((s, i) => s + recoveredOf(i), 0)
    const { withheld, leftover } = payout(recovered, ownerLamports)
    const credit = batch.reduce((s, i) => s + (i.kind === 'sweep' ? i.creditLamports : 0), 0)
    return { recovered, withheld, leftover, credit }
  }

  const batchIxs = (batch: Item[], withheld: number, leftover: number, credit: number): TransactionInstruction[] => {
    const flags = createFlags(batch, openedSinks)

    const ixs: TransactionInstruction[] = []
    for (const item of batch) {
      if (item.kind === 'sweep') {
        if (flags.get(item.box.address) && treasury) ixs.push(ataIx(item.box, item.sink, treasury))
        ixs.push(item.transfer, closeIx(item.box, closeDest, owner))
      } else if (item.kind === 'burn') {
        ixs.push(burnIx(item.box, owner), closeIx(item.box, closeDest, owner))
      } else if (item.kind === 'nft') {
        const nftInput = {
          owner,
          mint: new PublicKey(item.box.mint),
          token: new PublicKey(item.box.address),
          metadata: item.metadata,
          edition: item.edition,
          tokenProgram: programId(item.box),
          collectionMetadata: item.collectionMetadata,
        }
        ixs.push(
          item.tokenRecord
            ? burnV1Instruction({ ...nftInput, tokenRecord: item.tokenRecord, ruleSet: item.ruleSet })
            : burnNftInstruction(nftInput),
        )
      } else if (item.kind === 'refund') {
        ixs.push(withdrawExcessInstruction(
          new PublicKey(item.box.address),
          closeDest,
          owner,
          programId(item.box),
        ))
      } else {
        ixs.push(closeIx(item.box, closeDest, owner))
      }
    }
    const restToTreasury = Boolean(remainderTo && treasury && remainderTo.equals(treasury))
    if (treasury && withheld + (restToTreasury ? leftover : 0) > 0) {
      ixs.push(SystemProgram.transfer({
        fromPubkey: owner,
        toPubkey: treasury,
        lamports: withheld + (restToTreasury ? leftover : 0),
      }))
    }
    if (remainderTo && leftover > 0 && !restToTreasury) {
      ixs.push(SystemProgram.transfer({ fromPubkey: owner, toPubkey: remainderTo, lamports: leftover }))
    }
    if (credit > 0 && treasury && input.dest !== 'balance') {
      ixs.push(SystemProgram.transfer({
        fromPubkey: treasury,
        toPubkey: remainderTo ?? owner,
        lamports: credit,
      }))
    }
    return ixs
  }

  const encodeBatch = (batch: Item[]): PlannedTx => {
    const nftItems = batch.filter((i): i is NftItem => i.kind === 'nft')
    const refundAccounts = batch.filter((i) => i.kind === 'refund').map((i) => i.box.address)
    const closeAccounts = batch.filter((i) => i.kind !== 'nft' && i.kind !== 'refund').map((i) => i.box.address)
    const burnAccounts = batch.filter((i) => i.kind === 'burn').map((i) => i.box.address)
    const sweepAccounts = batch.filter((i) => i.kind === 'sweep').map((i) => i.box.address)
    const sinkAtas = [...new Set(batch.filter((i): i is SweepItem => i.kind === 'sweep').map((i) => i.sink.toBase58()))]
    const nftAccounts = nftItems.map((i) => i.box.address)
    const nftMetas = nftItems.map((i) => i.metadata.toBase58())
    const nftEditions = nftItems.map((i) => i.edition.toBase58())
    const { recovered, withheld, leftover, credit } = settle(batch)
    const ixs = batchIxs(batch, withheld, leftover, credit)
    const tx = buildTx(ixs, feePayer, blockhash, cuLimitFor(batch), cuPrice)
    for (const item of batch) {
      if (item.kind === 'sweep' && item.needsCreate) openedSinks.add(mintKey(item.box))
    }
    ownerLamports += recovered - withheld - (remainderTo ? leftover : 0)
    if (ownerPays) ownerLamports -= gasLamports
    if (credit > 0 && input.dest !== 'balance' && !remainderTo) ownerLamports += credit
    return encode(tx, batchType(batch), {
      closes: closeAccounts.length,
      burns: burnAccounts.length,
      sweeps: sweepAccounts.length,
      nfts: nftAccounts.length,
      refunds: refundAccounts.length,
      closeAccounts,
      burnAccounts,
      sweepAccounts,
      sinkAtas,
      nftAccounts,
      nftMetas,
      nftEditions,
      refundAccounts,
      closeDestination: closeDest.toBase58(),
      feeTo: treasury?.toBase58() ?? '',
      feeLamports: withheld,
      remainderTo: remainderTo?.toBase58(),
      remainderLamports: remainderTo ? leftover : undefined,
      creditTo: credit > 0 && input.dest !== 'balance' ? (remainderTo ?? owner).toBase58() : undefined,
      creditLamports: credit > 0 && input.dest !== 'balance' ? credit : undefined,
      recoveredLamports: recovered,
      // Withheld network gas comes off first; what remains (up to the fee rate) is Grabster's service fee.
      serviceFeeLamports: Math.max(0, Math.min(feeOf(recovered, input.dest), withheld - (needsTreasurySig && feePayer.equals(treasury!) ? solToLamports(ESTIMATED_GAS_SOL * 2) : 0))),
      balanceCreditLamports: credit > 0 && input.dest === 'balance' ? credit : undefined,
    })
  }

  const pack = (items: Item[]) => {
    if (!items.length) return
    let batch: Item[] = []
    const max = maxPerBatch(items[0].kind)
    const flush = (next?: Item) => {
      if (!batch.length) {
        if (next) batch = [next]
        return
      }
      planned.push(encodeBatch(batch))
      batch = next ? [next] : []
    }
    for (const item of items) {
      const trial = [...batch, item]
      const trialAmt = settle(trial)
      const trialIxs = batchIxs(trial, trialAmt.withheld, trialAmt.leftover, trialAmt.credit)
      if (batch.length && (trial.length > max || !fits(trialIxs, feePayer, blockhash, cuLimitFor(trial), cuPrice))) {
        flush(item)
      } else {
        batch = trial
      }
    }
    flush()
  }

  pack(nftItems)
  pack(sweepItems)
  pack(burns.map((box) => ({ kind: 'burn' as const, box })))
  pack(closable.map((box) => ({ kind: 'close' as const, box })))
  pack(refundItems)

  const recoveredLamports = planned.reduce((s, t) => s + t.description.recoveredLamports, 0)
  const feeLamports = planned.reduce((s, t) => s + t.description.feeLamports, 0)
  const creditLamports = planned.reduce((s, t) => s + (t.description.creditLamports ?? 0), 0)
  const remainderLamports = planned.reduce((s, t) => s + (t.description.remainderLamports ?? 0), 0)
  const sweepCredit = sweepItems.reduce((s, i) => s + i.creditLamports, 0)

  return putPlan({
    address: owner.toBase58(),
    dest: input.dest,
    destination: remainderTo?.toBase58() ?? owner.toBase58(),
    feePayer: feePayer.toBase58(),
    needsTreasurySig,
    feeLamports,
    netLamports: remainderTo
      ? remainderLamports + (input.dest === 'balance' ? sweepCredit : creditLamports)
      : recoveredLamports - feeLamports + creditLamports,
    recoveredLamports,
    txs: planned,
  })
}

async function pickSweeps(
  boxes: TokenBox[],
  treasury: PublicKey,
  rentNowSol: number,
  solUsd: number,
): Promise<SweepDraft[]> {
  if (!boxes.length) return []
  const groups = new Map<string, TokenBox[]>()
  for (const box of boxes) {
    const key = mintKey(box)
    const list = groups.get(key)
    if (list) list.push(box)
    else groups.set(key, [box])
  }

  const rows = [...groups.values()].map((group) => {
    const box = group[0]
    return {
      group,
      box,
      ata: getAssociatedTokenAddressSync(new PublicKey(box.mint), treasury, false, programId(box)),
    }
  })
  const infos = await withRpc(() => rpc().getMultipleAccountsInfo(rows.map((r) => r.ata)))

  const out: SweepDraft[] = []
  rows.forEach((row, i) => {
    const exists = Boolean(infos[i])
    const valueUsd = row.group.reduce((s, b) => s + sweepValueUsd(b), 0)
    const remembered = listedValueUsd(row.box.mint)
    const canOpen = ataCreateJustified(valueUsd, rentNowSol, solUsd, env.dustShare)
      || ataCreateJustified(remembered, rentNowSol, solUsd, env.dustShare)
    if (!exists && !canOpen) return
    for (const box of row.group) {
      out.push({
        kind: 'sweep',
        box,
        sink: row.ata,
        needsCreate: !exists,
        creditLamports: solToLamports(sweepCreditSol(sweepValueUsd(box), solUsd, env.dustShare)),
      })
    }
  })
  return out
}

async function assertTreasuryCanSweep(
  treasury: PublicKey,
  items: SweepItem[],
  rentNowSol: number,
  keepLamports: number,
) {
  const creates = new Set(items.filter((i) => i.needsCreate).map((i) => mintKey(i.box))).size
  const credit = items.reduce((s, i) => s + i.creditLamports, 0)
  const need = credit + solToLamports(rentNowSol * creates) + keepLamports
  const have = await withRpc(() => rpc().getBalance(treasury))
  if (have < need) {
    throw Object.assign(new Error('Grabster cannot take leftovers right now. Try again later.'), { status: 503 })
  }
}
