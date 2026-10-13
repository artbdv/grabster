import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { env } from '../../shared/env'
import { db, dbOn, markDbOff } from '../../shared/db'

export interface PartnerKey {
  key: string
  createdAt: string
}

interface Saved {
  secret: string
  createdAt: string
  hash: string
}

const byOwner = new Map<string, Saved & { owner: string }>()
const byHash = new Map<string, string>()

function remember(owner: string, secret: string, createdAt: string): Saved & { owner: string } {
  const prev = byOwner.get(owner)
  if (prev) byHash.delete(prev.hash)
  const hash = hashSecret(secret)
  const row = { owner, secret, createdAt, hash }
  byOwner.set(owner, row)
  byHash.set(hash, owner)
  return row
}

function dbFailed(err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  console.warn(`partner key db skipped (${message})`)
  if (/ECONN|timeout|terminated|connect|EAI_|ENOTFOUND|EHOSTUNREACH/i.test(message)) markDbOff()
}

function aesKey(): Buffer {
  return createHash('sha256').update(`partner-key:${env.accessSignKey}`).digest()
}

function seal(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', aesKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64url')
}

function open(packed: string): string {
  const raw = Buffer.from(packed, 'base64url')
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const enc = raw.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', aesKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

function mint(): string {
  return `gs_${randomBytes(24).toString('base64url')}`
}

async function readOwner(owner: string): Promise<Saved | null> {
  const cached = byOwner.get(owner)
  if (cached) return cached
  if (!dbOn()) return null
  try {
    const result = await db().query(
      'SELECT secret_enc, created_at FROM partner_api_key WHERE owner = $1',
      [owner],
    )
    const row = result.rows[0] as { secret_enc: string; created_at: Date } | undefined
    if (!row) return null
    const secret = open(row.secret_enc)
    return remember(owner, secret, new Date(row.created_at).toISOString())
  } catch (err) {
    dbFailed(err)
    return byOwner.get(owner) ?? null
  }
}

async function writeOwner(owner: string, secret: string, replace: boolean): Promise<PartnerKey> {
  const createdAt = new Date().toISOString()
  if (!dbOn()) {
    const row = remember(owner, secret, createdAt)
    return { key: row.secret, createdAt: row.createdAt }
  }
  const hash = hashSecret(secret)
  const sql = replace
    ? `INSERT INTO partner_api_key (owner, secret_hash, secret_enc, created_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (owner) DO UPDATE
         SET secret_hash = EXCLUDED.secret_hash,
             secret_enc = EXCLUDED.secret_enc,
             created_at = now()`
    : `INSERT INTO partner_api_key (owner, secret_hash, secret_enc)
       VALUES ($1, $2, $3)
       ON CONFLICT (owner) DO NOTHING`
  try {
    const result = await db().query(sql, [owner, hash, seal(secret)])
    if (replace || result.rowCount) {
      const row = remember(owner, secret, createdAt)
      return { key: row.secret, createdAt: row.createdAt }
    }
    const saved = await readOwner(owner)
    if (saved) return { key: saved.secret, createdAt: saved.createdAt }
  } catch (err) {
    dbFailed(err)
    if (!replace) {
      const saved = byOwner.get(owner)
      if (saved) return { key: saved.secret, createdAt: saved.createdAt }
    }
    const row = remember(owner, secret, createdAt)
    return { key: row.secret, createdAt: row.createdAt }
  }
  const row = remember(owner, secret, createdAt)
  return { key: row.secret, createdAt: row.createdAt }
}

export async function issuePartnerKey(owner: string): Promise<PartnerKey> {
  const existing = await readOwner(owner)
  if (existing) return { key: existing.secret, createdAt: existing.createdAt }
  return writeOwner(owner, mint(), false)
}

export async function rotatePartnerKey(owner: string): Promise<PartnerKey> {
  return writeOwner(owner, mint(), true)
}

export async function accountPartner(secret: string): Promise<{ name: string; id: string } | null> {
  const hash = hashSecret(secret)
  const cached = byHash.get(hash)
  if (cached) return { name: cached, id: hash.slice(0, 16) }
  if (!dbOn()) return null
  try {
    const result = await db().query(
      'SELECT owner FROM partner_api_key WHERE secret_hash = $1',
      [hash],
    )
    const row = result.rows[0] as { owner: string } | undefined
    if (!row) return null
    byHash.set(hash, row.owner)
    return { name: row.owner, id: hash.slice(0, 16) }
  } catch (err) {
    dbFailed(err)
    const owner = byHash.get(hash)
    return owner ? { name: owner, id: hash.slice(0, 16) } : null
  }
}
