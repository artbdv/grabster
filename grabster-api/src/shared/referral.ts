import { env } from './env'
import { db } from './db'
import { bookReferral, setReferralAvailableHook } from './ledger'

export async function ensureCode(owner: string): Promise<string> {
  const have = await db().query('SELECT code FROM ref_code WHERE owner = $1', [owner])
  if (have.rows[0]?.code) return String(have.rows[0].code)
  for (const n of [8, 10, 12, owner.length]) {
    const code = owner.slice(0, n)
    try {
      await db().query('INSERT INTO ref_code (code, owner) VALUES ($1, $2)', [code, owner])
      return code
    } catch (err) {
      if (typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === '23505') {
        const again = await db().query('SELECT code FROM ref_code WHERE owner = $1', [owner])
        if (again.rows[0]?.code) return String(again.rows[0].code)
      }
    }
  }
  throw new Error('Could not make a referral code.')
}

export async function ownerForCode(code: string): Promise<string | null> {
  const { rows } = await db().query('SELECT owner FROM ref_code WHERE code = $1', [code])
  return rows[0]?.owner ? String(rows[0].owner) : null
}

export async function attribute(referee: string, code: string): Promise<string | null> {
  const existing = await db().query('SELECT referrer, created_at, grabbed_at FROM ref_attr WHERE referee = $1', [referee])
  if (existing.rows[0]) {
    return String(existing.rows[0].referrer)
  }
  const referrer = await ownerForCode(code)
  if (!referrer || referrer === referee) return null
  try {
    await db().query(
      `INSERT INTO ref_attr (referee, referrer, code) VALUES ($1, $2, $3)`,
      [referee, referrer, code],
    )
  } catch (err) {
    if (typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === '23505') {
      const row = await db().query('SELECT referrer FROM ref_attr WHERE referee = $1', [referee])
      return row.rows[0]?.referrer ? String(row.rows[0].referrer) : null
    }
    throw err
  }
  return referrer
}

export async function markGrabbed(referee: string): Promise<void> {
  await db().query(
    `UPDATE ref_attr SET grabbed_at = COALESCE(grabbed_at, now()) WHERE referee = $1`,
    [referee],
  )
}

setReferralAvailableHook(markGrabbed)

/** `feeParts`: the Grabster service fee of each signed transaction (no withheld network fee). */
export async function creditReferrer(input: {
  referee: string
  code: string
  feeParts: number[]
  planId: string
  signatures: string[]
}): Promise<void> {
  const feeLamports = input.feeParts.reduce((s, f) => s + f, 0)
  if (!env.features.referrals || feeLamports <= 0 || !input.code) return
  const referrer = await attribute(input.referee, input.code)
  if (!referrer) return
  const parts = input.feeParts.map((f) => Math.floor((f * env.refShare) / 100))
  const cut = parts.reduce((s, c) => s + c, 0)
  if (cut <= 0) return
  // Pending until its transactions confirm; settlePending pays only the confirmed share.
  // grabbed_at is set from settleRow/markAvailable once credit is available (not on a failed plan).
  await bookReferral({
    owner: referrer,
    lamports: cut,
    planId: `ref-${input.planId}`,
    signatures: input.signatures,
    note: `${env.refShare}% of fee from a cleanup`,
    parts,
    subject: input.referee,
  })
}

export async function mineOf(owner: string) {
  const code = await ensureCode(owner)
  const counts = await db().query(
    `SELECT
       COUNT(*)::int AS invited,
       COUNT(grabbed_at)::int AS wallets
     FROM ref_attr WHERE referrer = $1`,
    [owner],
  )
  const money = await db().query(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'available' THEN lamports ELSE 0 END), 0) AS earned,
       COALESCE(SUM(CASE WHEN status = 'pending' THEN lamports ELSE 0 END), 0) AS pending
     FROM ledger WHERE owner = $1 AND kind = 'referral'`,
    [owner],
  )
  const guests = await db().query(
    `SELECT referee, grabbed_at FROM ref_attr WHERE referrer = $1 ORDER BY created_at DESC LIMIT 40`,
    [owner],
  )
  return {
    address: owner,
    code,
    invited: Number(counts.rows[0]?.invited) || 0,
    wallets: Number(counts.rows[0]?.wallets) || 0,
    earned: Number(money.rows[0]?.earned) || 0,
    pending: Number(money.rows[0]?.pending) || 0,
    earnedSol: (Number(money.rows[0]?.earned) || 0) / 1e9,
    pendingSol: (Number(money.rows[0]?.pending) || 0) / 1e9,
    share: env.refShare,
    guests: guests.rows.map((row) => ({
      addr: String(row.referee),
      cleaned: Boolean(row.grabbed_at),
    })),
  }
}

export async function leaders(you?: string) {
  const money = await db().query(
    `SELECT owner,
       COALESCE(SUM(CASE WHEN status = 'available' THEN lamports ELSE 0 END), 0) AS earned
     FROM ledger WHERE kind = 'referral'
     GROUP BY owner`,
  )
  const people = await db().query(
    `SELECT referrer, COUNT(grabbed_at)::int AS wallets
     FROM ref_attr GROUP BY referrer`,
  )
  const wallets = new Map<string, number>()
  for (const row of people.rows) wallets.set(String(row.referrer), Number(row.wallets) || 0)
  const rows = money.rows
    .map((row) => ({
      addr: String(row.owner),
      wallets: wallets.get(String(row.owner)) || 0,
      earned: (Number(row.earned) || 0) / 1e9,
    }))
    .filter((r) => r.earned > 0 || r.wallets > 0)
    .sort((a, b) => b.earned - a.earned)
    .slice(0, 20)
  const youRow = you
    ? {
      addr: you,
      wallets: wallets.get(you) || 0,
      earned: (Number(money.rows.find((r) => String(r.owner) === you)?.earned) || 0) / 1e9,
    }
    : null
  return { rows, you: youRow }
}
