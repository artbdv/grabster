import type { Destination, DustMode, InputKind, ScanEstimate, TokenBox } from '@grabster/solana-core'
import type { BulkPhase, BulkReportRow } from './bulk-run'

type Screen = 'hero' | 'scan' | 'result' | 'empty' | 'progress' | 'done'
interface Tx { ok: boolean; sig: string; boxes: number; wallet?: string; lamports?: number; dropped?: boolean }

const KEY = 'grabster.flow.v1'

export interface FlowSnap {
  v: 1
  mode: 'single' | 'bulk'
  screen: Screen
  dest: Destination
  other: string
  addr: string
  kind: InputKind
  input: string
  notice: string
  est: ScanEstimate | null
  boxes: TokenBox[]
  keepDust: string[]
  keepNft: string[]
  skipRefund: string[]
  dustMode: DustMode
  nftOn: boolean
  excessOn: boolean
  txs: Tx[]
  total: number
  bulkText: string
  bulkRows: ScanEstimate[]
  bulkReport: BulkReportRow[]
  bulkPhase: BulkPhase
  bulkExpect: string
  bulkQueueIndex: number
  bulkQueueTotal: number
  bulkAccept: string[]
  bulkList?: { addr: string; kind: 'address' | 'key' | 'seed' }[]
  bulkErrors?: Record<string, string>
  bulkExcess?: boolean
  advanced?: boolean
  partialPlan?: boolean
}

function safeKind(kind: InputKind | undefined): InputKind {
  return kind === 'key' || kind === 'seed' ? 'address' : (kind || 'address')
}

export function readFlowSnap(): FlowSnap | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as FlowSnap
    if (data?.v !== 1) return null
    return data
  } catch {
    return null
  }
}

export function writeFlowSnap(snap: FlowSnap) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(snap))
  } catch {
    /* quota or private mode */
  }
}

export function clearFlowSnap() {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(KEY)
}

export function sanitizeSnap(snap: FlowSnap): FlowSnap {
  const rows = snap.bulkRows.map((r) => ({ ...r, kind: safeKind(r.kind) }))
  let screen = snap.screen
  if (screen === 'progress' && snap.mode === 'single') screen = snap.est ? 'result' : 'hero'
  let phase = snap.bulkPhase
  if (snap.mode === 'bulk' && screen === 'progress' && (phase === 'signing' || phase === 'idle')) {
    phase = 'need-connect'
  }
  return {
    ...snap,
    kind: safeKind(snap.kind),
    input: snap.addr || '',
    notice: /private key|seed/i.test(snap.notice || '')
      ? 'Refresh dropped the key from this browser. Connect the wallet to continue.'
      : snap.notice,
    bulkRows: rows,
    // Keys never survive a reload, so key/seed rows come back as plain addresses.
    bulkList: (snap.bulkList || rows.map((r) => ({ addr: r.addr, kind: 'address' as const })))
      .map((w) => ({ addr: w.addr, kind: 'address' as const })),
    bulkText: rows.map((r) => r.addr).join('\n'),
    screen,
    bulkPhase: phase,
  }
}
