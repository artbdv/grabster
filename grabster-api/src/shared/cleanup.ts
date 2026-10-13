import { lamportsToSol, type PlanResponse } from '@grabster/solana-core'
import { db, dbOn } from './db'
import { env } from './env'

export type CleanupChannel = 'web' | 'batch' | 'api' | 'mcp'
export type OpsPeriod = '7d' | '30d' | '90d'

const PERIOD_DAYS: Record<OpsPeriod, number> = { '7d': 7, '30d': 30, '90d': 90 }

export async function ensureCleanupTable(): Promise<void> {
  if (!dbOn()) return
  await db().query(`
    CREATE TABLE IF NOT EXISTS cleanup (
      id bigserial PRIMARY KEY,
      plan_id text NOT NULL,
      address text NOT NULL,
      dest text NOT NULL,
      channel text NOT NULL,
      recovered_lamports bigint NOT NULL DEFAULT 0,
      fee_lamports bigint NOT NULL DEFAULT 0,
      gas_withheld_lamports bigint NOT NULL DEFAULT 0,
      accounts integer NOT NULL DEFAULT 0,
      tx_count integer NOT NULL DEFAULT 0,
      partial boolean NOT NULL DEFAULT false,
      signatures text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await db().query('CREATE UNIQUE INDEX IF NOT EXISTS cleanup_plan_uniq ON cleanup (plan_id)')
  await db().query('CREATE INDEX IF NOT EXISTS cleanup_created_idx ON cleanup (created_at)')
  await db().query('CREATE INDEX IF NOT EXISTS cleanup_channel_idx ON cleanup (channel)')
}

function planSlice(plan: PlanResponse, txCount: number) {
  const txs = plan.txs.slice(0, Math.max(0, txCount))
  let fee = 0
  let gasWithheld = 0
  let accounts = 0
  let recovered = 0
  for (const t of txs) {
    const d = t.description
    const service = d.serviceFeeLamports ?? d.feeLamports
    fee += service
    gasWithheld += Math.max(0, d.feeLamports - service)
    recovered += d.recoveredLamports
    accounts +=
      d.closeAccounts.length +
      d.burnAccounts.length +
      d.sweepAccounts.length +
      d.nftAccounts.length +
      d.refundAccounts.length
  }
  return { fee, gasWithheld, accounts, recovered, txCount: txs.length }
}

/** One row per successfully sent plan (or the part that was sent before a stop). */
export async function recordCleanup(input: {
  plan: PlanResponse
  signatures: string[]
  channel: CleanupChannel
  partial?: boolean
}): Promise<void> {
  if (!dbOn() || !input.signatures.length) return
  const slice = planSlice(input.plan, input.signatures.length)
  if (slice.txCount <= 0) return
  try {
    await db().query(
      `INSERT INTO cleanup (
         plan_id, address, dest, channel,
         recovered_lamports, fee_lamports, gas_withheld_lamports,
         accounts, tx_count, partial, signatures
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (plan_id) DO NOTHING`,
      [
        input.plan.planId,
        input.plan.address,
        input.plan.dest,
        input.channel,
        slice.recovered,
        slice.fee,
        slice.gasWithheld,
        slice.accounts,
        slice.txCount,
        Boolean(input.partial),
        input.signatures.join(' '),
      ],
    )
  } catch (err) {
    console.warn('Cleanup record failed', err)
  }
}

export interface OpsDay {
  day: string
  feeSol: number
  cleanups: number
}

export interface OpsShare {
  id: string
  label: string
  share: number
  feeSol: number
  feePct?: number
}

export interface OpsRecent {
  when: string
  channel: string
  address: string
  accounts: number
  recoveredSol: number
  feeSol: number
  dest: string
  partial: boolean
}

export interface OpsSnapshot {
  period: OpsPeriod
  rangeLabel: string
  feeSol: number
  feeDelta: number
  cleanups: number
  wallets: number
  accountsClosed: number
  recoveredSol: number
  gasWithheldSol: number
  avgFeeSol: number
  days: OpsDay[]
  channels: OpsShare[]
  dests: OpsShare[]
  recent: OpsRecent[]
  /** False when Postgres is off — dashboard must not invent numbers. */
  live: boolean
}

const CHANNEL_LABEL: Record<string, string> = {
  web: 'Single wallet',
  batch: 'Batch cleanup',
  api: 'API',
  mcp: 'MCP',
}

function destMeta(dest: string): { label: string; feePct: number } {
  if (dest === 'balance') return { label: 'Grabster balance', feePct: env.feeBalance }
  if (dest === 'other') return { label: 'Another address', feePct: env.feeDirect }
  if (dest === 'same') return { label: 'Back to each wallet', feePct: env.feeDirect }
  return { label: dest, feePct: env.feeDirect }
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function daysBack(n: number, from: Date): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() - i))
    out.push(utcDay(d))
  }
  return out
}

function labelRange(days: string[]): string {
  const a = new Date(`${days[0]}T00:00:00Z`)
  const b = new Date(`${days[days.length - 1]}T00:00:00Z`)
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  return `${fmt(a)} – ${fmt(b)}`
}

function emptySnapshot(period: OpsPeriod, live: boolean): OpsSnapshot {
  const daysIso = daysBack(PERIOD_DAYS[period], new Date())
  return {
    period,
    rangeLabel: labelRange(daysIso),
    feeSol: 0,
    feeDelta: 0,
    cleanups: 0,
    wallets: 0,
    accountsClosed: 0,
    recoveredSol: 0,
    gasWithheldSol: 0,
    avgFeeSol: 0,
    days: daysIso.map((day) => ({ day, feeSol: 0, cleanups: 0 })),
    channels: [],
    dests: [],
    recent: [],
    live,
  }
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000
}

export async function opsSnapshot(period: OpsPeriod): Promise<OpsSnapshot> {
  if (!dbOn()) return emptySnapshot(period, false)

  const length = PERIOD_DAYS[period]
  const now = new Date()
  const daysIso = daysBack(length, now)
  const from = new Date(`${daysIso[0]}T00:00:00.000Z`)
  const to = new Date(`${daysIso[daysIso.length - 1]}T23:59:59.999Z`)
  const prevTo = new Date(from.getTime() - 1)
  const prevFrom = new Date(prevTo)
  prevFrom.setUTCDate(prevFrom.getUTCDate() - (length - 1))
  prevFrom.setUTCHours(0, 0, 0, 0)

  const totals = await db().query<{
    cleanups: string
    fee: string
    recovered: string
    gas: string
    accounts: string
  }>(
    `SELECT
       COUNT(*)::text AS cleanups,
       COALESCE(SUM(fee_lamports), 0)::text AS fee,
       COALESCE(SUM(recovered_lamports), 0)::text AS recovered,
       COALESCE(SUM(gas_withheld_lamports), 0)::text AS gas,
       COALESCE(SUM(accounts), 0)::text AS accounts
     FROM cleanup
     WHERE created_at >= $1 AND created_at <= $2`,
    [from.toISOString(), to.toISOString()],
  )

  const prev = await db().query<{ fee: string }>(
    `SELECT COALESCE(SUM(fee_lamports), 0)::text AS fee
     FROM cleanup
     WHERE created_at >= $1 AND created_at <= $2`,
    [prevFrom.toISOString(), prevTo.toISOString()],
  )

  const byDay = await db().query<{ day: string; fee: string; cleanups: string }>(
    `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
            COALESCE(SUM(fee_lamports), 0)::text AS fee,
            COUNT(*)::text AS cleanups
     FROM cleanup
     WHERE created_at >= $1 AND created_at <= $2
     GROUP BY 1
     ORDER BY 1`,
    [from.toISOString(), to.toISOString()],
  )

  const byChannel = await db().query<{ channel: string; fee: string; n: string }>(
    `SELECT channel,
            COALESCE(SUM(fee_lamports), 0)::text AS fee,
            COUNT(*)::text AS n
     FROM cleanup
     WHERE created_at >= $1 AND created_at <= $2
     GROUP BY channel
     ORDER BY SUM(fee_lamports) DESC`,
    [from.toISOString(), to.toISOString()],
  )

  const byDest = await db().query<{ dest: string; fee: string; n: string }>(
    `SELECT dest,
            COALESCE(SUM(fee_lamports), 0)::text AS fee,
            COUNT(*)::text AS n
     FROM cleanup
     WHERE created_at >= $1 AND created_at <= $2
     GROUP BY dest
     ORDER BY SUM(fee_lamports) DESC`,
    [from.toISOString(), to.toISOString()],
  )

  const recentRows = await db().query<{
    created_at: Date
    channel: string
    address: string
    accounts: number
    recovered_lamports: string
    fee_lamports: string
    dest: string
    partial: boolean
  }>(
    `SELECT created_at, channel, address, accounts, recovered_lamports, fee_lamports, dest, partial
     FROM cleanup
     WHERE created_at >= $1 AND created_at <= $2
     ORDER BY created_at DESC
     LIMIT 10`,
    [from.toISOString(), to.toISOString()],
  )

  const t = totals.rows[0]
  const feeLamports = Number(t?.fee || 0)
  const prevFee = Number(prev.rows[0]?.fee || 0)
  const cleanups = Number(t?.cleanups || 0)
  const recoveredLamports = Number(t?.recovered || 0)
  const gasLamports = Number(t?.gas || 0)
  const accountsClosed = Number(t?.accounts || 0)
  const feeSol = round4(lamportsToSol(feeLamports))
  const feeDelta = prevFee > 0 ? (feeLamports - prevFee) / prevFee : 0

  const dayMap = new Map(byDay.rows.map((r) => [r.day, r]))
  const days: OpsDay[] = daysIso.map((day) => {
    const row = dayMap.get(day)
    return {
      day,
      feeSol: round4(lamportsToSol(Number(row?.fee || 0))),
      cleanups: Number(row?.cleanups || 0),
    }
  })

  const channelTotal = byChannel.rows.reduce((s, r) => s + Number(r.n), 0) || 1
  const channels: OpsShare[] = byChannel.rows.map((r) => ({
    id: r.channel,
    label: CHANNEL_LABEL[r.channel] || r.channel,
    share: Number(r.n) / channelTotal,
    feeSol: round4(lamportsToSol(Number(r.fee))),
  }))

  const destTotal = byDest.rows.reduce((s, r) => s + Number(r.n), 0) || 1
  const dests: OpsShare[] = byDest.rows.map((r) => {
    const meta = destMeta(r.dest)
    return {
      id: r.dest,
      label: meta.label,
      feePct: meta.feePct,
      share: Number(r.n) / destTotal,
      feeSol: round4(lamportsToSol(Number(r.fee))),
    }
  })

  const recent: OpsRecent[] = recentRows.rows.map((r) => ({
    when: new Date(r.created_at).toISOString(),
    channel: CHANNEL_LABEL[r.channel] || r.channel,
    address: r.address,
    accounts: r.accounts,
    recoveredSol: round4(lamportsToSol(Number(r.recovered_lamports))),
    feeSol: round4(lamportsToSol(Number(r.fee_lamports))),
    dest: destMeta(r.dest).label,
    partial: r.partial,
  }))

  return {
    period,
    rangeLabel: labelRange(daysIso),
    feeSol,
    feeDelta,
    cleanups,
    wallets: cleanups, // each recorded row is one wallet plan
    accountsClosed,
    recoveredSol: round4(lamportsToSol(recoveredLamports)),
    gasWithheldSol: round4(lamportsToSol(gasLamports)),
    avgFeeSol: cleanups ? round4(feeSol / cleanups) : 0,
    days,
    channels,
    dests,
    recent,
    live: true,
  }
}
