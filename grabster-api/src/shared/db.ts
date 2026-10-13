import { Pool } from 'pg'
import { env } from './env'

let pool: Pool | null = null
let enabled = false

export function dbOn(): boolean {
  return enabled
}

export function markDbOff() {
  enabled = false
  const dying = pool
  pool = null
  void dying?.end().catch(() => {})
}

export function db(): Pool {
  if (!pool) {
    pool = new Pool({
      user: env.dbUser,
      host: env.dbHost,
      database: env.dbName,
      password: env.dbPassword,
      port: env.dbPort,
      max: 6,
      connectionTimeoutMillis: 400,
    })
    pool.on('error', (err) => {
      console.warn(`Postgres dropped (${err.message}).`)
      markDbOff()
    })
  }
  return pool
}

export async function initDb(): Promise<boolean> {
  try {
    await db().query(`
      CREATE TABLE IF NOT EXISTS sink_allow (
        mint text PRIMARY KEY,
        symbol text NOT NULL DEFAULT '',
        last_value_usd double precision NOT NULL DEFAULT 0,
        last_liquidity_usd double precision NOT NULL DEFAULT 0,
        seen integer NOT NULL DEFAULT 0,
        swap_fails integer NOT NULL DEFAULT 0,
        last_swap_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await db().query('ALTER TABLE sink_allow ADD COLUMN IF NOT EXISTS swap_fails integer NOT NULL DEFAULT 0')
    await db().query('ALTER TABLE sink_allow ADD COLUMN IF NOT EXISTS last_swap_at timestamptz')
    await db().query(`
      CREATE TABLE IF NOT EXISTS ledger (
        id bigserial PRIMARY KEY,
        owner text NOT NULL,
        kind text NOT NULL,
        status text NOT NULL,
        lamports bigint NOT NULL,
        plan_id text,
        signatures text NOT NULL DEFAULT '',
        note text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(),
        confirmed_at timestamptz
      )
    `)
    // Lamports per signature (JSON array aligned with `signatures`) so a row settles to what actually confirmed.
    await db().query("ALTER TABLE ledger ADD COLUMN IF NOT EXISTS parts text NOT NULL DEFAULT ''")
    // For referral rows: the cleanup wallet (referee). Used to mark grabbed_at only after credit confirms.
    await db().query("ALTER TABLE ledger ADD COLUMN IF NOT EXISTS subject text NOT NULL DEFAULT ''")
    await db().query('CREATE INDEX IF NOT EXISTS ledger_owner_idx ON ledger (owner)')
    await db().query('CREATE INDEX IF NOT EXISTS ledger_status_idx ON ledger (status)')
    await db().query('CREATE UNIQUE INDEX IF NOT EXISTS ledger_plan_uniq ON ledger (plan_id) WHERE plan_id IS NOT NULL AND plan_id <> \'\'')
    await db().query(`
      CREATE TABLE IF NOT EXISTS ref_code (
        code text PRIMARY KEY,
        owner text NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await db().query(`
      CREATE TABLE IF NOT EXISTS ref_attr (
        referee text PRIMARY KEY,
        referrer text NOT NULL,
        code text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        grabbed_at timestamptz
      )
    `)
    await db().query('CREATE INDEX IF NOT EXISTS ref_attr_referrer_idx ON ref_attr (referrer)')
    await db().query(`
      CREATE TABLE IF NOT EXISTS partner_api_key (
        owner text PRIMARY KEY,
        secret_hash text NOT NULL UNIQUE,
        secret_enc text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    enabled = true
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`Postgres is off (${message}). Sink list stays in memory until the database is up.`)
    console.warn('Check DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD.')
    markDbOff()
    return false
  }
}
