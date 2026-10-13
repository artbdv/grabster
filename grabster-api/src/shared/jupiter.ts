import { WSOL_MINT, type TokenBox } from '@grabster/solana-core'
import { env } from './env'

const BASE = 'https://api.jup.ag'

interface PriceRow {
  usdPrice?: number
  liquidity?: number
}

interface TokenMeta {
  id?: string
  symbol?: string
  icon?: string
  logoURI?: string
}

function headers(): HeadersInit {
  return env.jupiterKey ? { 'x-api-key': env.jupiterKey } : {}
}

async function jupGet<T>(path: string): Promise<T | null> {
  if (!env.jupiterKey) return null
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(`${BASE}${path}`, { headers: headers(), signal: ctrl.signal })
    if (!res.ok) return null
    return await res.json() as T
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export interface SwapOrder {
  transaction: string
  requestId: string
  outAmount: string
  router?: string
}

export interface SwapResult {
  ok: boolean
  signature?: string
  outAmount?: string
  reason?: 'no_route' | 'failed'
}

async function jupFetch(path: string, init: RequestInit, ms: number): Promise<Response | null> {
  if (!env.jupiterKey) return null
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...headers(), ...(init.headers || {}) },
      signal: ctrl.signal,
    })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Meta-aggregator order. No route / empty tx → illiquid. */
export async function fetchSwapOrder(input: {
  inputMint: string
  outputMint: string
  amount: string
  taker: string
}): Promise<{ order: SwapOrder | null; noRoute: boolean }> {
  const qs = new URLSearchParams({
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    amount: input.amount,
    taker: input.taker,
  })
  const res = await jupFetch(`/swap/v2/order?${qs}`, { method: 'GET' }, 20_000)
  if (!res) return { order: null, noRoute: false }
  const body = await res.json().catch(() => null) as {
    transaction?: string | null
    requestId?: string
    outAmount?: string
    router?: string
    errorCode?: number
    errorMessage?: string
  } | null
  if (!res.ok || !body) {
    const text = `${body?.errorMessage || ''} ${res.status}`
    return { order: null, noRoute: /no.?route|not.?found|could not find|NO_ROUTES|COULD_NOT/i.test(text) || res.status === 404 }
  }
  if (!body.transaction || !body.requestId) {
    return { order: null, noRoute: true }
  }
  return {
    order: {
      transaction: body.transaction,
      requestId: body.requestId,
      outAmount: body.outAmount || '0',
      router: body.router,
    },
    noRoute: false,
  }
}

export async function executeSwap(signedTransaction: string, requestId: string): Promise<SwapResult> {
  const res = await jupFetch('/swap/v2/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedTransaction, requestId }),
  }, 60_000)
  if (!res) return { ok: false, reason: 'failed' }
  const body = await res.json().catch(() => null) as {
    status?: string
    signature?: string
    outputAmountResult?: string
    totalOutputAmount?: string
    error?: string
  } | null
  if (!res.ok || !body || body.status !== 'Success') {
    return { ok: false, signature: body?.signature, reason: 'failed' }
  }
  return {
    ok: true,
    signature: body.signature,
    outAmount: body.outputAmountResult || body.totalOutputAmount,
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

let solUsdCache = { value: 0, at: 0 }
const SOL_USD_TTL = 60_000

export async function fetchSolUsd(): Promise<number> {
  const now = Date.now()
  if (solUsdCache.value > 0 && now - solUsdCache.at < SOL_USD_TTL) return solUsdCache.value
  const prices = await fetchUsdPrices([])
  const value = prices.get(WSOL_MINT)?.usdPrice || 0
  if (value > 0) solUsdCache = { value, at: now }
  return value || solUsdCache.value
}

export async function fetchUsdPrices(mints: string[]): Promise<Map<string, PriceRow>> {
  const map = new Map<string, PriceRow>()
  const ids = [...new Set([...mints, WSOL_MINT])].filter(Boolean)
  if (!ids.length) return map
  for (const batch of chunks(ids, 50)) {
    const data = await jupGet<Record<string, PriceRow>>(`/price/v3?ids=${batch.join(',')}`)
    if (!data) continue
    for (const [mint, row] of Object.entries(data)) {
      if (row && typeof row.usdPrice === 'number' && Number.isFinite(row.usdPrice)) map.set(mint, row)
    }
  }
  return map
}

export async function fetchTokenMeta(mints: string[]): Promise<Map<string, { symbol: string; logo: string }>> {
  const map = new Map<string, { symbol: string; logo: string }>()
  const ids = [...new Set(mints)].filter(Boolean)
  if (!ids.length) return map
  for (const batch of chunks(ids, 100)) {
    const data = await jupGet<TokenMeta[]>(`/tokens/v2/search?query=${encodeURIComponent(batch.join(','))}`)
    if (!Array.isArray(data)) continue
    for (const row of data) {
      const mint = row.id || ''
      if (!mint) continue
      map.set(mint, { symbol: row.symbol || '', logo: row.icon || row.logoURI || '' })
    }
  }
  return map
}

export async function enrichBoxes(boxes: TokenBox[]): Promise<number> {
  const mints = boxes.filter((b) => b.amount !== '0' && !b.native).map((b) => b.mint)
  const [prices, meta] = await Promise.all([fetchUsdPrices(mints), fetchTokenMeta(mints)])
  const solUsd = prices.get(WSOL_MINT)?.usdPrice || 0
  if (solUsd > 0) solUsdCache = { value: solUsd, at: Date.now() }

  for (const box of boxes) {
    const quote = prices.get(box.mint)
    const info = meta.get(box.mint)
    box.symbol = info?.symbol || ''
    box.logo = info?.logo || ''
    if (!quote) continue
    const raw = Number(box.amount)
    const ui = raw / 10 ** Math.max(0, box.decimals)
    box.usdPrice = quote.usdPrice || 0
    box.liquidityUsd = quote.liquidity || 0
    box.valueUsd = ui * box.usdPrice
    box.hasPrice = box.usdPrice > 0
    if ((box.kind === 'dust' || box.kind === 'nft') && box.hasPrice && box.valueUsd >= env.keepAboveUsd) {
      box.kind = 'keep'
    }
  }

  return solUsd
}
