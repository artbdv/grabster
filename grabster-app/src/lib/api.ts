import type { BatchScanResponse, PlanResponse, PublicConfig, ScanResponse, SubmitResponse } from '@grabster/solana-core'
import { accessToken, clearAuthCookies, refreshToken, setAuthCookies } from './auth-cookies'

/**
 * API origin from VITE_API_URL (see docs/release-domain.md). Without it, local dev talks to the local
 * API and a production build falls back to its own origin, so a release never shows localhost.
 */
export const apiOrigin = (
  import.meta.env.VITE_API_URL
  || (import.meta.env.DEV ? 'http://localhost:8787' : window.location.origin)
).replace(/\/$/, '')
const API = apiOrigin

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly signatures: string[] = [],
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function isRebuildableError(err: unknown): boolean {
  if (err instanceof ApiError) {
    return err.code === 'blockhash_expired' || err.status === 409 || /blockhash|plan expired/i.test(err.message)
  }
  return err instanceof Error && /blockhash|plan expired/i.test(err.message)
}

function signaturesOf(err: unknown): string[] {
  return err instanceof ApiError ? err.signatures : []
}

export { signaturesOf }

export interface AuthPair {
  address: string
  accessToken: string
  refreshToken: string
}

let refreshWait: Promise<boolean> | null = null
let onSessionDead: (() => void) | null = null

export function onAuthDead(fn: (() => void) | null) {
  onSessionDead = fn
}

async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const obj = typeof body === 'object' && body ? body as { error?: string; code?: string; signatures?: string[] } : {}
    throw new ApiError(obj.error || res.statusText || 'Request failed', res.status, obj.code, obj.signatures || [])
  }
  return body as T
}

function url(path: string): string {
  return `${API}${path}`
}

function authHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra)
  const token = accessToken()
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
  return headers
}

async function tryRefresh(): Promise<boolean> {
  const token = refreshToken()
  if (!token) return false
  if (!refreshWait) {
    refreshWait = (async () => {
      try {
        const res = await fetch(url('/v1/auth/refresh'), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: token }),
        })
        const pair = await parse<AuthPair>(res)
        setAuthCookies(pair.accessToken, pair.refreshToken)
        return true
      } catch {
        clearAuthCookies()
        onSessionDead?.()
        return false
      } finally {
        refreshWait = null
      }
    })()
  }
  return refreshWait
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const res = await fetch(url(path), {
    ...init,
    credentials: 'include',
    headers: authHeaders(init.headers),
  })
  if (res.status === 401 && retry && !path.startsWith('/v1/auth/')) {
    if (await tryRefresh()) return request<T>(path, init, false)
  }
  return parse<T>(res)
}

export async function fetchConfig(): Promise<PublicConfig> {
  return request('/v1/config')
}

export async function fetchScan(address: string): Promise<ScanResponse> {
  return request(`/v1/scan/${encodeURIComponent(address)}`)
}

export async function fetchScanBatch(addresses: string[]): Promise<BatchScanResponse> {
  return request('/v1/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addresses }),
  })
}

export async function fetchBalance(address: string): Promise<{ address: string; lamports: number; sol: number }> {
  return request(`/v1/scan/${encodeURIComponent(address)}/balance`)
}

export async function fetchPlan(body: {
  address: string
  dest: 'same' | 'other' | 'balance'
  other?: string
  burnDust?: boolean
  burnAccounts?: string[]
  sweepAccounts?: string[]
  burnNft?: boolean
  nftAccounts?: string[]
  refundExcess?: boolean
  refundAccounts?: string[]
}): Promise<PlanResponse> {
  return request('/v1/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export type TxState = 'pending' | 'confirmed' | 'failed'

export async function fetchTxStatus(signatures: string[]): Promise<{ statuses: { signature: string; state: TxState; error?: string }[] }> {
  return request('/v1/submit/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signatures }),
  })
}

export async function fetchSubmit(
  planId: string,
  txs: string[],
  ref?: string,
  channel: 'web' | 'batch' = 'web',
): Promise<SubmitResponse> {
  return request('/v1/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId, txs, ref: ref || undefined, channel }),
  })
}

export type OpsPeriod = '7d' | '30d' | '90d'

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
  days: { day: string; feeSol: number; cleanups: number }[]
  channels: { id: string; label: string; share: number; feeSol: number }[]
  dests: { id: string; label: string; share: number; feeSol: number; feePct?: number }[]
  recent: {
    when: string
    channel: string
    address: string
    accounts: number
    recoveredSol: number
    feeSol: number
    dest: string
    partial: boolean
  }[]
  live: boolean
}

export async function fetchOps(period: OpsPeriod): Promise<OpsSnapshot> {
  return request(`/v1/ops?period=${period}`)
}

export interface LedgerLine {
  id: number
  kind: string
  status: string
  lamports: number
  sol: number
  signatures: string[]
  note: string
  createdAt: string
  confirmedAt: string | null
}

export interface WithdrawQuote {
  minSol: number
  feeSol: number
  dailySol: number
  availableSol: number
  usedSol: number
  leftSol: number
  maxSol: number
  can: boolean
}

export interface BalanceBook {
  address: string
  available: number
  pending: number
  availableSol: number
  pendingSol: number
  withdraw: WithdrawQuote
  rows: LedgerLine[]
}

export async function fetchAuthChallenge(address: string): Promise<{ address: string; message: string }> {
  return request(`/v1/auth/challenge?address=${encodeURIComponent(address)}`, {}, false)
}

export async function fetchAuthVerify(body: { address: string; message: string; signature: string }): Promise<AuthPair> {
  return request('/v1/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, false)
}

export async function fetchAuthMe(): Promise<{ address: string }> {
  if (!accessToken() && refreshToken()) {
    if (!(await tryRefresh())) throw new ApiError('Not signed in.', 401)
  }
  try {
    return await request('/v1/auth/me', {}, false)
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && await tryRefresh()) {
      return request('/v1/auth/me', {}, false)
    }
    throw e
  }
}

export async function fetchAuthLogout(): Promise<void> {
  const token = refreshToken()
  try {
    await request('/v1/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: token || undefined }),
    }, false)
  } catch {
    /* cookies still get cleared locally */
  } finally {
    clearAuthCookies()
  }
}

export async function fetchLedger(): Promise<BalanceBook> {
  return request('/v1/balance')
}

export interface RefMine {
  address: string
  code: string
  invited: number
  wallets: number
  earnedSol: number
  pendingSol: number
  share: number
  guests: { addr: string; cleaned: boolean }[]
}

export interface RefLeaders {
  rows: { addr: string; wallets: number; earned: number }[]
  you: { addr: string; wallets: number; earned: number } | null
}

export async function fetchRefMe(): Promise<RefMine> {
  return request('/v1/ref/me')
}

export async function fetchRefLeaders(): Promise<RefLeaders> {
  return request('/v1/ref/leaders')
}

export interface PartnerKeyResponse {
  key: string
  createdAt: string
}

export function fetchPartnerKey(): Promise<PartnerKeyResponse> {
  return request('/v1/partner/key')
}

export function rotatePartnerKey(): Promise<PartnerKeyResponse> {
  return request('/v1/partner/key/rotate', { method: 'POST' })
}

export async function fetchWithdraw(sol: number): Promise<{ signature: string; sentSol: number; feeSol: number; sol: number }> {
  return request('/v1/balance/withdraw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sol }),
  })
}
