import { rpc } from '../../shared/rpc'
import { ledgerFor, markAvailable, markFailed, pendingRows, settleRow, type LedgerRow } from '../../shared/ledger'
import { withdrawQuote } from './withdraw'

/**
 * A transaction can't land after its blockhash expires (~1–2 min). Past this age, a signature the RPC
 * can't find even in history was dropped.
 */
const DROPPED_AFTER_MS = 10 * 60_000

/** A signature with no status past the window: ask for the transaction itself before calling it dropped. */
async function landedLate(sig: string): Promise<'ok' | 'failed' | 'dropped'> {
  const tx = await rpc().getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
  if (!tx) return 'dropped'
  return tx.meta?.err ? 'failed' : 'ok'
}

/** Credits booked with per-signature amounts settle to what actually confirmed; dropped or failed txs drop out. */
async function settleParts(row: LedgerRow, parts: number[]): Promise<void> {
  const st = await rpc().getSignatureStatuses(row.signatures, { searchTransactionHistory: true })
  const list = st.value || []
  const old = Date.now() - new Date(row.createdAt).getTime() > DROPPED_AFTER_MS
  let confirmed = 0
  for (let i = 0; i < row.signatures.length; i++) {
    const s = list[i]
    if (s?.err) continue
    if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) {
      confirmed += parts[i]
      continue
    }
    // Still inside the blockhash window: wait. Past it, a non-confirmed status is not proof the tx will
    // land — ask history (landedLate) instead of returning forever on a stuck "processed" object.
    if (!old) return
    const late = await landedLate(row.signatures[i])
    if (late === 'ok') confirmed += parts[i]
  }
  const booked = parts.reduce((a, b) => a + b, 0)
  if (confirmed < booked) {
    console.warn(`Ledger row ${row.id} (${row.kind}, plan ${row.planId}) settles at ${confirmed} of ${booked} lamports: some transactions did not land.`)
  }
  await settleRow(row.id, confirmed)
}

async function settleAll(): Promise<void> {
  const rows = await pendingRows()
  for (const row of rows) {
    if (!row.signatures.length) continue
    try {
      if (row.parts && (row.kind === 'grab' || row.kind === 'referral')) {
        await settleParts(row, row.parts)
        continue
      }
      // Rows without per-signature amounts (withdrawals, older credits): all or nothing, as before.
      const st = await rpc().getSignatureStatuses(row.signatures, { searchTransactionHistory: true })
      const list = st.value || []
      if (list.some((s) => s?.err)) {
        await markFailed(row.id)
        continue
      }
      if (list.length && list.every((s) => s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized'))) {
        await markAvailable(row.planId)
      }
    } catch {
      /* leave pending */
    }
  }
}

let settling: Promise<void> | null = null

/** One pass at a time; callers that arrive mid-pass wait for it instead of skipping. */
export function settlePending(): Promise<void> {
  if (!settling) settling = settleAll().finally(() => { settling = null })
  return settling
}

export async function balanceOf(owner: string) {
  await settlePending()
  const book = await ledgerFor(owner)
  const withdraw = await withdrawQuote(owner)
  return {
    address: owner,
    available: book.available,
    pending: book.pending,
    availableSol: book.available / 1e9,
    pendingSol: book.pending / 1e9,
    withdraw,
    rows: book.rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      lamports: r.lamports,
      sol: r.lamports / 1e9,
      signatures: r.signatures,
      note: r.note,
      createdAt: r.createdAt,
      confirmedAt: r.confirmedAt,
    })),
  }
}
