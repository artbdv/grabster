import { lamportsToSol, type PlanResponse, type ScanEstimate } from '@grabster/solana-core'
import { fetchPlan, fetchSubmit, isRebuildableError, signaturesOf } from './api'
import { storedRef } from './ref'
import { secretFor } from './secrets'
import { signWithAdapter, signWithSecret } from './sign'
import { signAllWallet, wallet } from './wallet'

export const BULK_PARALLEL = 6

export type BulkPhase = 'idle' | 'need-connect' | 'signing' | 'need-switch'

export interface BulkReportRow {
  addr: string
  status: 'closed' | 'skipped' | 'failed' | 'clean'
  boxes: number
  sol: number
  signatures: string[]
  note: string
  /** Some transactions landed from a plan that then failed or was rebuilt. */
  partialPlan?: boolean
}

type Waiter = { resolve: () => void; reject: (err: Error) => void }

let connectWait: Waiter | null = null
let nextWait: Waiter | null = null

function dropWait(wait: Waiter | null, err?: Error) {
  if (!wait) return
  if (err) wait.reject(err)
  else wait.resolve()
}

export function abortBulkWaits(reason = 'stopped') {
  const err = new Error(reason)
  dropWait(connectWait, err)
  dropWait(nextWait, err)
  connectWait = null
  nextWait = null
}

export function waitBulkConnect() {
  dropWait(connectWait, new Error('replaced'))
  return new Promise<void>((resolve, reject) => {
    connectWait = { resolve, reject }
  })
}

export function fulfillBulkConnect() {
  dropWait(connectWait)
  connectWait = null
}

export function skipBulkConnect() {
  dropWait(connectWait, new Error('skip'))
  connectWait = null
}

export function waitBulkAdvance() {
  dropWait(nextWait, new Error('replaced'))
  return new Promise<void>((resolve, reject) => {
    nextWait = { resolve, reject }
  })
}

export function fulfillBulkAdvance() {
  dropWait(nextWait)
  nextWait = null
}

export function canSignBulkRow(row: ScanEstimate): boolean {
  return Boolean(secretFor(row.addr) || wallet.publicKey === row.addr)
}

export function skippedRow(addr: string, boxes: number, note: string): BulkReportRow {
  return { addr, status: 'skipped', boxes, sol: 0, signatures: [], note }
}

export function bulkHasWork(row: ScanEstimate, withExcess = false): boolean {
  return row.empty > 0 || (withExcess && row.excess > 0)
}

export function planBodyBulk(address: string, dest: 'same' | 'other' | 'balance', other: string, row?: ScanEstimate, withExcess = false) {
  return {
    address,
    dest,
    other: dest === 'other' ? other : undefined,
    burnDust: false,
    burnNft: false,
    refundExcess: Boolean(withExcess && row?.excess),
  }
}

/**
 * SOL a planned transaction delivers to the recipient. With another address or the Grabster balance as
 * recipient that is the transferred remainder (the server keeps the source wallet's rent-exempt minimum);
 * otherwise it is what stays in the wallet: recovered − withheld (fee, covered gas) + leftover credit.
 */
export function txLamports(t: PlanResponse['txs'][number]): number {
  const d = t.description
  if (d.remainderTo) return Math.max(0, (d.remainderLamports ?? 0) + (d.creditLamports ?? 0) + (d.balanceCreditLamports ?? 0))
  return Math.max(0, d.recoveredLamports - d.feeLamports + (d.creditLamports ?? 0))
}

function txBoxes(t: PlanResponse['txs'][number]): number {
  return t.description.closes + (t.description.nfts || 0) + (t.description.refunds || 0)
}

export function pendingFrom(plan: PlanResponse, address: string) {
  return plan.txs.map((t) => ({
    ok: false,
    sig: '…',
    boxes: txBoxes(t),
    wallet: address,
    lamports: txLamports(t),
  }))
}

export async function runPool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  const q = [...items]
  const workers = Array.from({ length: Math.min(Math.max(1, n), q.length || 1) }, async () => {
    while (q.length) {
      const item = q.shift()
      if (item !== undefined) await fn(item)
    }
  })
  await Promise.all(workers)
}

export async function runBulkWallet(input: {
  address: string
  dest: 'same' | 'other' | 'balance'
  other: string
  row?: ScanEstimate
  withExcess?: boolean
  append: (rows: { ok: boolean; sig: string; boxes: number; wallet?: string; lamports?: number }[]) => number
  /** Mark the landed rows of an attempt; rows after them (up to `planned`) were never sent. */
  mark: (start: number, signatures: string[], planned?: number) => void
}): Promise<BulkReportRow> {
  const { address, dest, other, row, append, mark } = input
  let lastErr = ''
  // Transactions that landed in earlier attempts stay counted when a later attempt rebuilds the plan.
  const sent: string[] = []
  let sentBoxes = 0
  let sentLamports = 0
  for (let attempt = 0; attempt < 3; attempt++) {
    let plan: PlanResponse | null = null
    let start = -1
    try {
      plan = await fetchPlan(planBodyBulk(address, dest, other, row, input.withExcess))
      if (!plan.txs.length) {
        // Everything left was already sent by an earlier attempt.
        if (sent.length) return { addr: address, status: 'closed', boxes: sentBoxes, sol: lamportsToSol(sentLamports), signatures: sent, note: '', partialPlan: true }
        return { addr: address, status: 'clean', boxes: 0, sol: 0, signatures: [], note: 'nothing to close' }
      }
      start = append(pendingFrom(plan, address))
      const secret = secretFor(address)
      const signed = secret
        ? signWithSecret(plan, secret)
        : await signWithAdapter(plan, address, signAllWallet)
      const { signatures } = await fetchSubmit(plan.planId, signed, storedRef(), 'batch')
      mark(start, signatures, plan.txs.length)
      return {
        addr: address,
        status: 'closed',
        boxes: sentBoxes + plan.txs.reduce((s, t) => s + txBoxes(t), 0),
        sol: lamportsToSol(sentLamports + plan.txs.reduce((s, t) => s + txLamports(t), 0)),
        signatures: [...sent, ...signatures],
        note: '',
        partialPlan: sent.length > 0,
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : 'Failed'
      const landed = signaturesOf(e)
      if (plan && start >= 0) {
        mark(start, landed, plan.txs.length)
        landed.forEach((sig, i) => {
          sent.push(sig)
          sentBoxes += txBoxes(plan!.txs[i])
          sentLamports += txLamports(plan!.txs[i])
        })
      }
      if (!isRebuildableError(e) || attempt === 2) break
    }
  }
  if (sent.length) {
    return { addr: address, status: 'failed', boxes: sentBoxes, sol: lamportsToSol(sentLamports), signatures: sent, note: lastErr || 'stopped before the last transaction', partialPlan: true }
  }
  return { addr: address, status: 'failed', boxes: 0, sol: 0, signatures: [], note: lastErr }
}

export function bulkReportCsv(rows: BulkReportRow[]): string {
  const header = 'wallet,status,boxes,sol,signatures,note'
  const lines = rows.map((r) => [
    r.addr,
    r.status,
    String(r.boxes),
    r.sol.toFixed(6),
    r.signatures.join(' '),
    r.note.replace(/"/g, "'"),
  ].map((c) => (c.includes(',') || c.includes(' ') ? `"${c}"` : c)).join(','))
  return [header, ...lines].join('\n')
}

export function downloadCsv(name: string, body: string) {
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
