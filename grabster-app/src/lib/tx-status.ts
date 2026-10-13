import { reactive } from 'vue'
import { fetchTxStatus, type TxState } from './api'

/** 'unknown' = not seen on chain within the watch window (likely dropped or still in flight). */
export type TxView = TxState | 'unknown'

const POLL_MS = 2500
/** After blockhash expiry a tx that never confirms is almost certainly dropped; keep a little margin. */
const GIVE_UP_MS = 180_000
const BATCH = 100
const STORE_KEY = 'grabster.tx-since.v1'

const states = reactive<Record<string, TxView>>({})
const since = new Map<string, number>()
let timer: number | undefined
let polling = false

function loadSince() {
  try {
    const raw = sessionStorage.getItem(STORE_KEY)
    if (!raw) return
    const obj = JSON.parse(raw) as Record<string, number>
    const now = Date.now()
    for (const [sig, at] of Object.entries(obj)) {
      if (typeof at === 'number' && now - at < GIVE_UP_MS * 2) since.set(sig, at)
    }
  } catch { /* private mode / bad JSON */ }
}

function persistSince() {
  try {
    const obj: Record<string, number> = {}
    const now = Date.now()
    for (const [sig, at] of since) {
      if (now - at < GIVE_UP_MS * 2) obj[sig] = at
    }
    sessionStorage.setItem(STORE_KEY, JSON.stringify(obj))
  } catch { /* ignore */ }
}

loadSince()

export function txState(sig: string): TxView {
  return states[sig] ?? 'pending'
}

function open(): string[] {
  return [...since.keys()].filter((sig) => {
    const s = states[sig]
    return s !== 'confirmed' && s !== 'failed' && s !== 'unknown'
  })
}

async function poll() {
  timer = undefined
  polling = true
  try {
    const live = open()
    const checked = new Set<string>()
    for (let i = 0; i < live.length; i += BATCH) {
      try {
        const { statuses } = await fetchTxStatus(live.slice(i, i + BATCH))
        for (const row of statuses) {
          states[row.signature] = row.state
          checked.add(row.signature)
        }
      } catch {
        /* keep polling; the next round may reach the API */
      }
    }
    // Give up only on signatures a successful check still found pending past the window.
    const now = Date.now()
    for (const sig of open()) {
      if (checked.has(sig) && now - (since.get(sig) ?? now) > GIVE_UP_MS) states[sig] = 'unknown'
    }
    persistSince()
  } finally {
    polling = false
  }
  schedule(open().length > BATCH ? POLL_MS * 2 : POLL_MS)
}

function schedule(ms: number) {
  if (timer !== undefined || polling || !open().length) return
  timer = window.setTimeout(poll, ms)
}

/** Start following signatures until each is confirmed, failed, or the watch window ends. */
export function watchSignatures(signatures: string[]) {
  const now = Date.now()
  let added = false
  for (const sig of signatures) {
    if (!sig || sig === '…') continue
    // Keep the original watch start across reloads (sessionStorage); only seed "now" for new sigs.
    if (!since.has(sig)) {
      since.set(sig, now)
      added = true
    }
    if (!(sig in states)) states[sig] = 'pending'
  }
  if (added) persistSince()
  schedule(600)
}
