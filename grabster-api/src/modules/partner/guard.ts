import { createHash, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { env } from '../../shared/env'
import { accountPartner } from './keys'

const WINDOW_MS = 60_000
const hits = new Map<string, number[]>()

const SECRET_KEYS = /^(secret|privatekey|private_key|mnemonic|seed|keypair|feetopubkey)$/i

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status })
}

function keyId(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

export async function authenticatePartner(header: string): Promise<{ name: string; id: string }> {
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  const presented = match?.[1] || ''
  if (!presented) throw httpError(401, 'Missing partner API key.')
  const presentedBuf = Buffer.from(presented)
  let found: { name: string; id: string } | null = null
  for (const row of env.partnerKeys) {
    const candidate = Buffer.from(row.secret)
    if (candidate.length === presentedBuf.length && timingSafeEqual(candidate, presentedBuf)) {
      found = { name: row.name, id: keyId(row.secret) }
    }
  }
  if (found) return found
  const account = await accountPartner(presented)
  if (!account) throw httpError(401, 'Invalid partner API key.')
  return account
}

export function rejectSecrets(body: unknown) {
  if (!body || typeof body !== 'object') return
  for (const key of Object.keys(body)) {
    if (SECRET_KEYS.test(key) || key === 'feeTo' || key === 'feePayer') {
      throw httpError(400, 'Private keys and fee recipients are not accepted. Sign on your side; the fee address is fixed.')
    }
  }
}

function takeSlot(id: string): { limit: number; remaining: number } {
  const now = Date.now()
  const recent = (hits.get(id) || []).filter((at) => now - at < WINDOW_MS)
  const limit = env.partnerRatePerMin
  if (recent.length >= limit) {
    hits.set(id, recent)
    const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now - recent[0])) / 1000))
    throw Object.assign(httpError(429, 'Rate limit exceeded.'), { retryAfter })
  }
  recent.push(now)
  hits.set(id, recent)
  return { limit, remaining: limit - recent.length }
}

export function requirePartner(req: Request, res: Response, next: NextFunction) {
  authenticatePartner(req.header('authorization') || '').then((partner) => {
    const slot = takeSlot(partner.id)
    res.set('X-RateLimit-Limit', String(slot.limit))
    res.set('X-RateLimit-Remaining', String(slot.remaining))
    res.locals.partnerName = partner.name
    next()
  }).catch((err: unknown) => {
    if (typeof err === 'object' && err && 'retryAfter' in err) {
      res.set('Retry-After', String((err as { retryAfter: number }).retryAfter))
    }
    next(err)
  })
}
