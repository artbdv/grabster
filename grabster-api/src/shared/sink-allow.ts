import { isProtectedMint, isTransferableBox, type TokenBox } from '@grabster/solana-core'
import { db } from './db'

interface Entry {
  symbol: string
  lastValueUsd: number
  lastLiquidityUsd: number
  seen: number
  swapFails: number
}

const cache = new Map<string, Entry>()

export async function loadSinkAllow(): Promise<void> {
  try {
    const { rows } = await db().query<{
      mint: string
      symbol: string
      last_value_usd: number
      last_liquidity_usd: number
      seen: number
      swap_fails: number
    }>('SELECT mint, symbol, last_value_usd, last_liquidity_usd, seen, swap_fails FROM sink_allow')
    cache.clear()
    for (const row of rows) {
      cache.set(row.mint, {
        symbol: row.symbol || '',
        lastValueUsd: Number(row.last_value_usd) || 0,
        lastLiquidityUsd: Number(row.last_liquidity_usd) || 0,
        seen: Number(row.seen) || 0,
        swapFails: Number(row.swap_fails) || 0,
      })
    }
  } catch {
    /* initDb already warned if Postgres is down */
  }
}

export function isListedMint(mint: string): boolean {
  return cache.has(mint)
}

export function listedValueUsd(mint: string): number {
  return cache.get(mint)?.lastValueUsd || 0
}

/** Remember mints that Jupiter said were liquid. Next scans can Give them even without a live price. */
export async function rememberLiquidMints(boxes: TokenBox[]): Promise<void> {
  const now = new Date()
  const rows: Array<{ mint: string } & Entry> = []
  for (const box of boxes) {
    if (isProtectedMint(box.mint) || !isTransferableBox(box)) continue
    if (!box.hasPrice || box.valueUsd <= 0 || box.liquidityUsd <= 0) continue
    const prev = cache.get(box.mint)
    const next: Entry = {
      symbol: box.symbol || prev?.symbol || '',
      lastValueUsd: Math.max(box.netValueUsd || box.valueUsd, prev?.lastValueUsd || 0),
      lastLiquidityUsd: Math.max(box.liquidityUsd, prev?.lastLiquidityUsd || 0),
      seen: (prev?.seen || 0) + 1,
      swapFails: prev?.swapFails || 0,
    }
    cache.set(box.mint, next)
    rows.push({ mint: box.mint, ...next })
  }
  if (!rows.length) return
  try {
    const values: unknown[] = []
    const placeholders = rows.map((row, i) => {
      const n = i * 6
      values.push(row.mint, row.symbol, row.lastValueUsd, row.lastLiquidityUsd, 1, now)
      return `($${n + 1}, $${n + 2}, $${n + 3}, $${n + 4}, $${n + 5}, $${n + 6})`
    })
    await db().query(
      `INSERT INTO sink_allow (mint, symbol, last_value_usd, last_liquidity_usd, seen, updated_at)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (mint) DO UPDATE SET
         symbol = CASE WHEN EXCLUDED.symbol = '' THEN sink_allow.symbol ELSE EXCLUDED.symbol END,
         last_value_usd = GREATEST(sink_allow.last_value_usd, EXCLUDED.last_value_usd),
         last_liquidity_usd = GREATEST(sink_allow.last_liquidity_usd, EXCLUDED.last_liquidity_usd),
         seen = sink_allow.seen + 1,
         updated_at = EXCLUDED.updated_at`,
      values,
    )
  } catch {
    /* cache still has the row for this process */
  }
}

export function listedSymbol(mint: string): string {
  return cache.get(mint)?.symbol || ''
}

export function swapFailsOf(mint: string): number {
  return cache.get(mint)?.swapFails || memoryFails.get(mint) || 0
}

export async function markSwapOk(mint: string): Promise<void> {
  memoryFails.delete(mint)
  const prev = cache.get(mint)
  if (prev) cache.set(mint, { ...prev, swapFails: 0 })
  try {
    await db().query(
      'UPDATE sink_allow SET swap_fails = 0, last_swap_at = now() WHERE mint = $1',
      [mint],
    )
  } catch {
    /* memory is enough for this process */
  }
}

export async function markSwapFail(mint: string): Promise<number> {
  const next = swapFailsOf(mint) + 1
  memoryFails.set(mint, next)
  const prev = cache.get(mint)
  if (prev) cache.set(mint, { ...prev, swapFails: next })
  try {
    await db().query(
      `INSERT INTO sink_allow (mint, symbol, swap_fails, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (mint) DO UPDATE SET
         swap_fails = $3,
         updated_at = now()`,
      [mint, prev?.symbol || '', next],
    )
  } catch {
    /* memory is enough for this process */
  }
  return next
}

export async function dropMint(mint: string): Promise<void> {
  cache.delete(mint)
  memoryFails.delete(mint)
  try {
    await db().query('DELETE FROM sink_allow WHERE mint = $1', [mint])
  } catch {
    /* gone from this process either way */
  }
}

const memoryFails = new Map<string, number>()
