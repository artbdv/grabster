import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { PublicKey } from '@solana/web3.js'
import type { Response } from 'express'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { env } from './env'

const AT = 'grabster_at'
const RT = 'grabster_rt'

type Kind = 'access' | 'refresh'

const challenges = new Map<string, { at: number; nonce: string }>()
const refreshAlive = new Map<string, { address: string; exp: number }>()

setInterval(() => {
  const now = Date.now()
  for (const [addr, row] of challenges) {
    if (now - row.at > 5 * 60_000) challenges.delete(addr)
  }
  for (const [jti, row] of refreshAlive) {
    if (now > row.exp) refreshAlive.delete(jti)
  }
}, 60_000).unref()

export function challengeMessage(address: string): string {
  const nonce = randomBytes(16).toString('hex')
  challenges.set(address, { at: Date.now(), nonce })
  return [
    'Grabster wants you to sign in.',
    '',
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join('\n')
}

export function verifySiws(address: string, message: string, signature: string): boolean {
  const row = challenges.get(address)
  if (!row) return false
  challenges.delete(address)
  if (Date.now() - row.at > 5 * 60_000) return false
  if (!message.includes(address) || !message.includes(row.nonce)) return false
  try {
    const key = new PublicKey(address).toBytes()
    const sig = bs58.decode(signature)
    return nacl.sign.detached.verify(new TextEncoder().encode(message), sig, key)
  } catch {
    return false
  }
}

function secretFor(kind: Kind): string {
  return kind === 'refresh' ? env.refreshSignKey : env.accessSignKey
}

function sign(kind: Kind, body: string): string {
  const mac = createHmac('sha256', secretFor(kind)).update(body).digest('hex')
  return Buffer.from(`${body}.${mac}`).toString('base64url')
}

function issueToken(kind: Kind, address: string, ttl: number, jti = ''): string {
  const exp = Date.now() + ttl
  const body = jti ? `${kind}.${address}.${exp}.${jti}` : `${kind}.${address}.${exp}`
  return sign(kind, body)
}

function readToken(token: string, expect?: Kind): { kind: Kind; address: string; jti: string } | null {
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8')
    const last = raw.lastIndexOf('.')
    if (last < 0) return null
    const body = raw.slice(0, last)
    const mac = raw.slice(last + 1)
    const kindHint = body.split('.')[0] as Kind
    const keyKind = expect || (kindHint === 'refresh' ? 'refresh' : 'access')
    const expectMac = createHmac('sha256', secretFor(keyKind)).update(body).digest('hex')
    if (mac.length !== expectMac.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expectMac))) return null
    const parts = body.split('.')
    const kind = parts[0] as Kind
    if (kind !== 'access' && kind !== 'refresh') return null
    if (expect && kind !== expect) return null
    const address = parts[1]
    const exp = Number(parts[2])
    const jti = parts[3] || ''
    if (!address || !exp || Date.now() > exp) return null
    new PublicKey(address)
    return { kind, address, jti }
  } catch {
    return null
  }
}

export function issuePair(address: string): { address: string; accessToken: string; refreshToken: string } {
  const accessToken = issueToken('access', address, env.accessTtlMs)
  const jti = randomBytes(16).toString('hex')
  const refreshToken = issueToken('refresh', address, env.refreshTtlMs, jti)
  refreshAlive.set(jti, { address, exp: Date.now() + env.refreshTtlMs })
  return { address, accessToken, refreshToken }
}

export function rotateRefresh(refreshToken: string): { address: string; accessToken: string; refreshToken: string } | null {
  const parsed = readToken(refreshToken, 'refresh')
  if (!parsed) return null
  const row = refreshAlive.get(parsed.jti)
  if (!row || row.address !== parsed.address || Date.now() > row.exp) return null
  refreshAlive.delete(parsed.jti)
  return issuePair(parsed.address)
}

export function revokeRefresh(refreshToken: string) {
  const parsed = readToken(refreshToken, 'refresh')
  if (parsed?.jti) refreshAlive.delete(parsed.jti)
}

export function accessAddress(token: string): string | null {
  return readToken(token, 'access')?.address ?? null
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const key = part.slice(0, i).trim()
    const val = part.slice(i + 1).trim()
    if (!key) continue
    try { out[key] = decodeURIComponent(val) } catch { out[key] = val }
  }
  return out
}

function cookieOpts(maxAgeMs: number) {
  const secure = process.env.COOKIE_SECURE === '1'
  return {
    httpOnly: true,
    path: '/',
    maxAge: maxAgeMs,
    sameSite: (secure ? 'none' : 'lax') as 'none' | 'lax',
    secure,
  }
}

export function writeAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie(AT, accessToken, cookieOpts(env.accessTtlMs))
  res.cookie(RT, refreshToken, cookieOpts(env.refreshTtlMs))
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(AT, { path: '/' })
  res.clearCookie(RT, { path: '/' })
}

function headerText(req: { header: (n: string) => unknown }, name: string): string {
  const raw = req.header(name)
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0]
  return ''
}

export function cookiesOf(req: { header: (n: string) => unknown }): { access: string; refresh: string } {
  const cookies = parseCookies(headerText(req, 'cookie') || undefined)
  return { access: cookies[AT] || '', refresh: cookies[RT] || '' }
}

export function bearerAddress(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null
  return accessAddress(header.slice(7).trim())
}

export function sessionAddress(req: { header: (n: string) => unknown }): string | null {
  // If the client sent Authorization, use only that — never fall back to cookies. Otherwise a cross-site
  // page could pass a junk Authorization header (bypassing the CSRF origin check) and still act as the
  // cookie session (withdraw, balance plan, etc.).
  const auth = headerText(req, 'authorization')
  if (auth) return bearerAddress(auth)
  return accessAddress(cookiesOf(req).access)
}

export function requireSession(req: { header: (n: string) => unknown }): string {
  const who = sessionAddress(req)
  if (!who) {
    throw Object.assign(new Error('Sign in first so leftovers land in your Grabster balance.'), { status: 401 })
  }
  return who
}

export function refreshFrom(req: { header: (n: string) => unknown }, bodyToken?: string): string {
  return (bodyToken || cookiesOf(req).refresh || '').trim()
}
