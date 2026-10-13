import { LAMPORTS_PER_SOL } from './programs'

export function short(addr: string): string {
  return addr ? addr.slice(0, 4) + '…' + addr.slice(-4) : ''
}

export function fmt(x: number, d = 3): string {
  if (!Number.isFinite(x)) return '0'
  if (x === 0) return '0'
  const sign = x < 0 ? '-' : ''
  const abs = Math.abs(x)
  let dec = d
  let n = Math.round(abs * 10 ** dec) / 10 ** dec
  while (n === 0 && dec < 9) {
    dec++
    n = Math.round(abs * 10 ** dec) / 10 ** dec
  }
  return sign + (n.toFixed(dec).replace(/\.?0+$/, '') || '0')
}

export function fill(s: string, v: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => (v[k] !== undefined ? String(v[k]) : '{' + k + '}'))
}

export function lamportsToSol(lamports: number | bigint): number {
  return Number(lamports) / LAMPORTS_PER_SOL
}

export function solToLamports(sol: number): number {
  return Math.round(sol * LAMPORTS_PER_SOL)
}

export function fmtUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd === 0) return '$0'
  const sign = usd < 0 ? '-' : ''
  return `${sign}$${fmt(Math.abs(usd), 2)}`
}

/** USD for a SOL amount. Empty when the price is missing or the amount is 0. */
export function bucks(sol: number, solUsd: number): string {
  if (!(solUsd > 0) || !Number.isFinite(sol) || sol === 0) return ''
  return fmtUsd(Math.abs(sol) * solUsd)
}

export function withBucks(sol: number, solUsd: number, decimals?: number): string {
  const body = `${fmt(sol, decimals)} SOL`
  const b = bucks(sol, solUsd)
  return b ? `${body} (${b})` : body
}
