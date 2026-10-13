import type { BulkReportRow } from './bulk-run'
import { txState, type TxView } from './tx-status'

export type StatusKey = 'ok' | 'bad' | 'wait' | 'none'

export const TX_LABEL: Record<TxView, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  failed: 'Failed',
  unknown: 'Not confirmed — may have been dropped',
}

export const TX_KEY: Record<TxView, StatusKey> = {
  pending: 'wait',
  confirmed: 'ok',
  failed: 'bad',
  unknown: 'none',
}

/** A finished wallet row: its chain state follows its transactions. */
export function walletOutcome(r: BulkReportRow): { key: StatusKey; label: string } {
  if (r.status === 'clean') return { key: 'none', label: 'Nothing to close' }
  if (r.status === 'skipped') return { key: 'none', label: 'Skipped' }
  if (r.status === 'failed' && !r.signatures.length) return { key: 'bad', label: 'Failed' }
  const states = r.signatures.map(txState)
  if (states.some((s) => s === 'failed')) return { key: 'bad', label: 'Failed on chain' }
  if (states.some((s) => s === 'unknown')) return { key: 'bad', label: 'Not confirmed' }
  if (r.status === 'failed') return { key: 'bad', label: 'Partly sent' }
  if (states.length && states.every((s) => s === 'confirmed')) return { key: 'ok', label: 'Confirmed' }
  return { key: 'wait', label: 'Sent · confirming' }
}
