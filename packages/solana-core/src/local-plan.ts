import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createBurnCheckedInstruction,
  createCloseAccountInstruction,
} from '@solana/spl-token'
import { bytesToB64 } from './bytes'
import { canRefundExcess, refundWorthIt, withdrawExcessInstruction } from './excess'
import { lamportsToSol, solToLamports } from './format'
import {
  ESTIMATED_GAS_SOL,
  REFUND_PER_BATCH,
  TX_PER_BATCH,
} from './programs'
import { buildTx, fits } from './tx'
import type { PlanResponse, PlannedTx, TokenBox } from './types'

type CloseItem = { kind: 'close'; box: TokenBox }
type BurnItem = { kind: 'burn'; box: TokenBox }
type RefundItem = { kind: 'refund'; box: TokenBox }
type Item = CloseItem | BurnItem | RefundItem

export interface LocalPlanInput {
  address: string
  boxes: TokenBox[]
  solLamports: number
  systemRentLamports: number
  blockhash: string
  priorityMicroLamports: number
  /** Empty token accounts are closed unless this is false. */
  closeEmpty?: boolean
  burnAccounts?: string[]
  /** Refund every worthwhile extra deposit, or only `refundAccounts` when that list is set. */
  refundExcess?: boolean
  refundAccounts?: string[]
  /** Percent of recovered rent sent to `treasury`. The local file always sets this. */
  feePercent?: number
  treasury?: string
}

function programId(box: TokenBox) {
  return box.program === 'token2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
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

function recoveredOf(item: Item): number {
  if (item.kind === 'refund') return item.box.excessLamports
  return item.box.lamports
}

function encode(tx: ReturnType<typeof buildTx>, type: PlannedTx['type'], extra: PlannedTx['description']): PlannedTx {
  const raw = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
  const messageHash = bytesToB64(tx.compileMessage().serialize())
  return {
    id: messageHash.slice(0, 16),
    type,
    tx: bytesToB64(raw),
    messageHash,
    description: extra,
  }
}

function batchType(batch: Item[]): PlannedTx['type'] {
  if (batch.some((i) => i.kind === 'burn')) return 'BURN'
  if (batch.some((i) => i.kind === 'refund')) return 'REFUND'
  return 'CLOSE'
}

function maxPerBatch(kind: Item['kind']): number {
  if (kind === 'refund') return REFUND_PER_BATCH
  return TX_PER_BATCH
}

function cuLimitFor(batch: Item[]): number {
  if (batch.every((i) => i.kind === 'refund')) return 50_000 + batch.length * 8_000
  const heavy = batch.some((i) => i.kind === 'burn')
  return 50_000 + batch.length * (heavy ? 40_000 : 12_000)
}

function fail(message: string): never {
  throw new Error(message)
}

function byAddress(boxes: TokenBox[]): Map<string, TokenBox> {
  return new Map(boxes.map((box) => [box.address, box]))
}

/**
 * Owner pays the network fee. Rent returns to the same wallet.
 * No sweep, no Grabster fee, no treasury signature.
 */
export function buildLocalPlan(input: LocalPlanInput): PlanResponse {
  const owner = new PublicKey(input.address)
  const known = byAddress(input.boxes)
  const closable = input.closeEmpty === false
    ? []
    : input.boxes.filter((b) => b.kind === 'empty' && !b.frozen)

  const burns: TokenBox[] = []
  for (const address of [...new Set(input.burnAccounts || [])]) {
    let key: PublicKey
    try {
      key = new PublicKey(address)
    } catch {
      fail('A burn account address is invalid.')
    }
    const box = known.get(key.toBase58())
    if (!box) fail('A burn account is not on this wallet.')
    if (box.kind !== 'dust' || box.native || box.frozen) fail('That token account cannot be burned.')
    if (box.delegate) fail('This token account has a delegate and cannot be burned here.')
    burns.push(box)
  }

  const closing = new Set([...closable.map((b) => b.address), ...burns.map((b) => b.address)])
  let refunds: TokenBox[] = []
  if (input.refundExcess) {
    const picked = input.refundAccounts?.length
      ? input.refundAccounts
      : null
    if (picked) {
      for (const address of [...new Set(picked)]) {
        let key: PublicKey
        try {
          key = new PublicKey(address)
        } catch {
          fail('A refund account address is invalid.')
        }
        const box = known.get(key.toBase58())
        if (!box) fail('A refund account is not on this wallet.')
        if (closing.has(box.address)) continue
        if (!canRefundExcess(box)) fail('That account has no extra deposit to refund.')
        refunds.push(box)
      }
    } else {
      refunds = input.boxes.filter((b) => canRefundExcess(b) && !closing.has(b.address))
      const pile = refunds.reduce((s, b) => s + b.excessLamports, 0)
      if (!refundWorthIt(pile, refunds.length)) refunds = []
    }
  }

  if (!closable.length && !burns.length && !refunds.length) fail('Nothing to grab.')

  const gasLamports = solToLamports(ESTIMATED_GAS_SOL)
  const reserve = input.systemRentLamports + gasLamports
  if (input.solLamports < reserve) fail('Not enough SOL to pay network fees.')

  const closeDest = owner
  const feePayer = owner
  let ownerLamports = input.solLamports
  const planned: PlannedTx[] = []
  const feePercent = Math.min(100, Math.max(0, input.feePercent ?? 0))
  let treasury: PublicKey | null = null
  if (input.treasury && feePercent > 0) {
    try {
      treasury = new PublicKey(input.treasury)
    } catch {
      fail('Grabster fee address is invalid.')
    }
    if (treasury.equals(owner)) treasury = null
  }

  const withheldFor = (recovered: number, wallet: number): number => {
    if (!treasury || recovered <= 0) return 0
    let withheld = Math.floor((recovered * feePercent) / 100)
    if (withheld > recovered) withheld = recovered
    if (wallet + recovered - withheld < reserve) {
      withheld = Math.max(0, Math.min(withheld, wallet + recovered - reserve))
    }
    return withheld
  }

  const batchIxs = (batch: Item[], withheld: number): TransactionInstruction[] => {
    const ixs: TransactionInstruction[] = []
    for (const item of batch) {
      if (item.kind === 'burn') ixs.push(burnIx(item.box, owner), closeIx(item.box, closeDest, owner))
      else if (item.kind === 'refund') {
        ixs.push(withdrawExcessInstruction(new PublicKey(item.box.address), closeDest, owner, programId(item.box)))
      } else ixs.push(closeIx(item.box, closeDest, owner))
    }
    if (withheld > 0 && treasury) {
      ixs.push(SystemProgram.transfer({ fromPubkey: owner, toPubkey: treasury, lamports: withheld }))
    }
    return ixs
  }

  const encodeBatch = (batch: Item[]): PlannedTx => {
    const recovered = batch.reduce((s, i) => s + recoveredOf(i), 0)
    const withheld = withheldFor(recovered, ownerLamports)
    const closeAccounts = batch.filter((i) => i.kind !== 'refund').map((i) => i.box.address)
    const burnAccounts = batch.filter((i) => i.kind === 'burn').map((i) => i.box.address)
    const refundAccounts = batch.filter((i) => i.kind === 'refund').map((i) => i.box.address)
    const ixs = batchIxs(batch, withheld)
    const tx = buildTx(ixs, feePayer, input.blockhash, cuLimitFor(batch), input.priorityMicroLamports)
    ownerLamports += recovered - withheld - gasLamports
    if (ownerLamports < input.systemRentLamports) fail('Not enough SOL to pay network fees for every transaction.')
    return encode(tx, batchType(batch), {
      closes: closeAccounts.length,
      burns: burnAccounts.length,
      sweeps: 0,
      nfts: 0,
      refunds: refundAccounts.length,
      closeAccounts,
      burnAccounts,
      sweepAccounts: [],
      sinkAtas: [],
      nftAccounts: [],
      nftMetas: [],
      nftEditions: [],
      refundAccounts,
      closeDestination: closeDest.toBase58(),
      feeTo: withheld > 0 && treasury ? treasury.toBase58() : '',
      feeLamports: withheld,
      recoveredLamports: recovered,
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
      const trialRecovered = trial.reduce((s, i) => s + recoveredOf(i), 0)
      const trialIxs = batchIxs(trial, withheldFor(trialRecovered, ownerLamports))
      if (batch.length && (trial.length > max || !fits(trialIxs, feePayer, input.blockhash, cuLimitFor(trial), input.priorityMicroLamports))) {
        flush(item)
      } else batch = trial
    }
    flush()
  }

  pack(burns.map((box) => ({ kind: 'burn' as const, box })))
  pack(closable.map((box) => ({ kind: 'close' as const, box })))
  pack(refunds.map((box) => ({ kind: 'refund' as const, box })))

  const recoveredLamports = planned.reduce((s, t) => s + t.description.recoveredLamports, 0)
  const feeLamports = planned.reduce((s, t) => s + t.description.feeLamports, 0)
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const planId = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

  return {
    planId,
    address: owner.toBase58(),
    dest: 'same',
    destination: owner.toBase58(),
    feePayer: owner.toBase58(),
    needsTreasurySig: false,
    feeLamports,
    netLamports: recoveredLamports - feeLamports,
    recoveredLamports,
    txs: planned,
  }
}

async function readPriority(connection: Connection): Promise<number> {
  try {
    const fees = await connection.getRecentPrioritizationFees()
    if (!fees.length) return 1_000
    const sorted = fees.map((f) => f.prioritizationFee).sort((a, b) => a - b)
    const mid = sorted[Math.floor(sorted.length / 2)] ?? 0
    return Math.min(50_000, Math.max(1_000, mid || 1_000))
  } catch {
    return 1_000
  }
}

export async function planLocal(
  connection: Connection,
  input: Omit<LocalPlanInput, 'solLamports' | 'systemRentLamports' | 'blockhash' | 'priorityMicroLamports'>,
): Promise<PlanResponse> {
  const owner = new PublicKey(input.address)
  const [hash, priorityMicroLamports, systemRentLamports, solLamports] = await Promise.all([
    connection.getLatestBlockhash('finalized'),
    readPriority(connection),
    connection.getMinimumBalanceForRentExemption(0),
    connection.getBalance(owner),
  ])
  return buildLocalPlan({
    ...input,
    address: owner.toBase58(),
    solLamports,
    systemRentLamports,
    blockhash: hash.blockhash,
    priorityMicroLamports,
  })
}

/** Plain-language review. Rent returns to the same wallet after the Grabster fee. */
export function explainLocalPlan(plan: PlanResponse): string[] {
  const lines = [
    `Fee payer: ${plan.feePayer}`,
    `Grabster fee: ${lamportsToSol(plan.feeLamports)} SOL`,
    `You keep: ${lamportsToSol(plan.netLamports)} SOL`,
    `Recovered: ${lamportsToSol(plan.recoveredLamports)} SOL`,
    `Transactions: ${plan.txs.length}`,
    plan.feeLamports > 0
      ? 'Programs: Compute Budget, SPL Token, Token-2022, System (Grabster fee).'
      : 'Programs: Compute Budget, SPL Token, Token-2022.',
  ]
  for (const tx of plan.txs) {
    const d = tx.description
    const bits: string[] = []
    if (d.burns) bits.push(`burn ${d.burns}`)
    if (d.closes) bits.push(`close ${d.closes}`)
    if (d.refunds) bits.push(`refund extra deposit on ${d.refunds}`)
    lines.push(`${tx.type}: ${bits.join(', ')}; ${lamportsToSol(d.recoveredLamports)} SOL`)
    for (const account of d.burnAccounts) lines.push(`  burn ${account}`)
    for (const account of d.closeAccounts) {
      if (!d.burnAccounts.includes(account)) lines.push(`  close ${account}`)
    }
    for (const account of d.refundAccounts) lines.push(`  refund ${account}`)
  }
  return lines
}
