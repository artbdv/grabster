import { db } from './db'

export type LedgerKind = 'grab' | 'referral' | 'withdraw'
export type LedgerStatus = 'pending' | 'available' | 'failed'

export interface LedgerRow {
  id: number
  owner: string
  kind: LedgerKind
  status: LedgerStatus
  lamports: number
  planId: string
  signatures: string[]
  note: string
  createdAt: string
  confirmedAt: string | null
  /** Lamports per signature, when the row was booked with them. */
  parts: number[] | null
  /** Referral rows: the cleanup wallet (referee). */
  subject: string
}

/** Called when a referral credit becomes available so grabbed_at tracks confirmed cleanups only. */
let onReferralAvailable: ((referee: string) => Promise<void>) | null = null

export function setReferralAvailableHook(fn: (referee: string) => Promise<void>) {
  onReferralAvailable = fn
}

async function notifyReferralAvailable(subject: string) {
  if (!subject || !onReferralAvailable) return
  try {
    await onReferralAvailable(subject)
  } catch (err) {
    console.warn('Referral grabbed mark failed', err)
  }
}

function parseParts(raw: string | null | undefined, n: number): number[] | null {
  if (!raw) return null
  try {
    const parts = JSON.parse(raw) as unknown
    if (!Array.isArray(parts) || parts.length !== n || !parts.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0)) return null
    return parts.map(Number)
  } catch {
    return null
  }
}

function mapRow(row: {
  id: number
  owner: string
  kind: string
  status: string
  lamports: string | number
  plan_id: string | null
  signatures: string
  note: string
  created_at: Date
  confirmed_at: Date | null
  parts?: string | null
  subject?: string | null
}): LedgerRow {
  const signatures = row.signatures ? row.signatures.split(' ').filter(Boolean) : []
  return {
    id: Number(row.id),
    owner: row.owner,
    kind: row.kind as LedgerKind,
    status: row.status as LedgerStatus,
    lamports: Number(row.lamports) || 0,
    planId: row.plan_id || '',
    signatures,
    note: row.note || '',
    createdAt: new Date(row.created_at).toISOString(),
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null,
    parts: parseParts(row.parts, signatures.length),
    subject: row.subject || '',
  }
}

function warnDuplicate(planId: string) {
  console.warn(`Ledger: a row for plan ${planId} already exists; the new booking was not added.`)
}

export async function bookCredit(input: {
  owner: string
  lamports: number
  planId: string
  signatures: string[]
  note?: string
  parts?: number[]
}): Promise<void> {
  if (input.lamports <= 0) return
  try {
    await db().query(
      `INSERT INTO ledger (owner, kind, status, lamports, plan_id, signatures, note, parts)
       VALUES ($1, 'grab', 'pending', $2, $3, $4, $5, $6)`,
      [input.owner, input.lamports, input.planId, input.signatures.join(' '), input.note || 'Grab to Grabster balance', input.parts ? JSON.stringify(input.parts) : ''],
    )
  } catch (err) {
    if (typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === '23505') return warnDuplicate(input.planId)
    throw err
  }
}

export async function bookReferral(input: {
  owner: string
  lamports: number
  planId: string
  signatures: string[]
  note?: string
  parts?: number[]
  /** Cleanup wallet; grabbed_at is set only once this row settles available. */
  subject?: string
}): Promise<void> {
  if (input.lamports <= 0) return
  try {
    await db().query(
      `INSERT INTO ledger (owner, kind, status, lamports, plan_id, signatures, note, parts, subject)
       VALUES ($1, 'referral', 'pending', $2, $3, $4, $5, $6, $7)`,
      [
        input.owner,
        input.lamports,
        input.planId,
        input.signatures.join(' '),
        input.note || 'Referral share',
        input.parts ? JSON.stringify(input.parts) : '',
        input.subject || '',
      ],
    )
  } catch (err) {
    if (typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === '23505') return warnDuplicate(input.planId)
    throw err
  }
}

/** Close a pending row at the amount that actually confirmed (0 → failed). */
export async function settleRow(id: number, lamports: number): Promise<void> {
  if (lamports > 0) {
    const { rows } = await db().query(
      `UPDATE ledger SET status = 'available', lamports = $2, confirmed_at = now()
       WHERE id = $1 AND status = 'pending'
       RETURNING kind, subject`,
      [id, lamports],
    )
    const row = rows[0]
    if (row?.kind === 'referral' && row.subject) await notifyReferralAvailable(String(row.subject))
  } else {
    await db().query(`UPDATE ledger SET status = 'failed' WHERE id = $1 AND status = 'pending'`, [id])
  }
}

export async function markAvailable(planId: string): Promise<void> {
  const { rows } = await db().query(
    `UPDATE ledger SET status = 'available', confirmed_at = now()
     WHERE plan_id = $1 AND status = 'pending'
     RETURNING kind, subject`,
    [planId],
  )
  for (const row of rows) {
    if (row.kind === 'referral' && row.subject) await notifyReferralAvailable(String(row.subject))
  }
}

export async function pendingRows(): Promise<LedgerRow[]> {
  const { rows } = await db().query(
    `SELECT id, owner, kind, status, lamports, plan_id, signatures, note, created_at, confirmed_at, parts, subject
     FROM ledger WHERE status = 'pending'`,
  )
  return rows.map(mapRow)
}

export async function markFailed(id: number): Promise<void> {
  await db().query(`UPDATE ledger SET status = 'failed' WHERE id = $1 AND status = 'pending'`, [id])
}

export async function attachSignatures(id: number, signatures: string[]): Promise<void> {
  await db().query(`UPDATE ledger SET signatures = $2 WHERE id = $1`, [id, signatures.join(' ')])
}

export async function markRowAvailable(id: number): Promise<void> {
  await db().query(
    `UPDATE ledger SET status = 'available', confirmed_at = now() WHERE id = $1 AND status = 'pending'`,
    [id],
  )
}

export async function totalsFor(owner: string): Promise<{ credit: number; pendingIn: number; withdrawn: number }> {
  const { rows } = await db().query(
    `SELECT
       COALESCE(SUM(CASE WHEN kind IN ('grab', 'referral') AND status = 'available' THEN lamports ELSE 0 END), 0) AS credit,
       COALESCE(SUM(CASE WHEN kind IN ('grab', 'referral') AND status = 'pending' THEN lamports ELSE 0 END), 0) AS pending_in,
       COALESCE(SUM(CASE WHEN kind = 'withdraw' AND status IN ('pending', 'available') THEN lamports ELSE 0 END), 0) AS withdrawn
     FROM ledger WHERE owner = $1`,
    [owner],
  )
  const row = rows[0] || {}
  return {
    credit: Number(row.credit) || 0,
    pendingIn: Number(row.pending_in) || 0,
    withdrawn: Number(row.withdrawn) || 0,
  }
}

export async function withdrawUsedToday(owner: string): Promise<number> {
  const { rows } = await db().query(
    `SELECT COALESCE(SUM(lamports), 0) AS used
     FROM ledger
     WHERE owner = $1
       AND kind = 'withdraw'
       AND status IN ('pending', 'available')
       AND created_at >= date_trunc('day', timezone('utc', now()))`,
    [owner],
  )
  return Number(rows[0]?.used) || 0
}

export async function bookWithdraw(input: {
  owner: string
  lamports: number
  note: string
  minLamports: number
  dailyLamports: number
}): Promise<{ id: number; planId: string }> {
  const client = await db().connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.owner])
    const sums = await client.query(
      `SELECT
         COALESCE(SUM(CASE WHEN kind IN ('grab', 'referral') AND status = 'available' THEN lamports ELSE 0 END), 0) AS credit,
         COALESCE(SUM(CASE WHEN kind = 'withdraw' AND status IN ('pending', 'available') THEN lamports ELSE 0 END), 0) AS withdrawn
       FROM ledger WHERE owner = $1`,
      [input.owner],
    )
    const credit = Number(sums.rows[0]?.credit) || 0
    const withdrawn = Number(sums.rows[0]?.withdrawn) || 0
    const available = Math.max(0, credit - withdrawn)
    if (input.lamports > available) {
      throw Object.assign(new Error('Not enough available.'), { status: 400 })
    }
    const day = await client.query(
      `SELECT COALESCE(SUM(lamports), 0) AS used
       FROM ledger
       WHERE owner = $1
         AND kind = 'withdraw'
         AND status IN ('pending', 'available')
         AND created_at >= date_trunc('day', timezone('utc', now()))`,
      [input.owner],
    )
    const used = Number(day.rows[0]?.used) || 0
    if (used + input.lamports > input.dailyLamports) {
      throw Object.assign(new Error('Daily withdraw limit reached.'), { status: 400 })
    }
    if (input.lamports < input.minLamports) {
      throw Object.assign(new Error('Below the minimum withdraw.'), { status: 400 })
    }
    const planId = `wd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const { rows } = await client.query(
      `INSERT INTO ledger (owner, kind, status, lamports, plan_id, signatures, note)
       VALUES ($1, 'withdraw', 'pending', $2, $3, '', $4)
       RETURNING id`,
      [input.owner, input.lamports, planId, input.note],
    )
    await client.query('COMMIT')
    return { id: Number(rows[0].id), planId }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function ledgerFor(owner: string): Promise<{
  available: number
  pending: number
  rows: LedgerRow[]
}> {
  const totals = await totalsFor(owner)
  const { rows } = await db().query(
    `SELECT id, owner, kind, status, lamports, plan_id, signatures, note, created_at, confirmed_at, parts, subject
     FROM ledger WHERE owner = $1 ORDER BY id DESC LIMIT 80`,
    [owner],
  )
  return {
    available: Math.max(0, totals.credit - totals.withdrawn),
    pending: totals.pendingIn,
    rows: rows.map(mapRow),
  }
}
