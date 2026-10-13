/**
 * Leftover helpers shared by screens.
 * Scan / plan / submit go through the API.
 */
import { classifyInput } from '@grabster/solana-core'

export { classifyInput }
export { fmt, fill, short, lamportsToSol, bucks, withBucks } from '@grabster/solana-core'
export type { Destination, DustMode, InputKind, ScanEstimate as Estimate, PublicConfig } from '@grabster/solana-core'
export { totals, bulkTotals, networkFeeSol, treasuryGasWithholdSol, type Totals } from '@grabster/solana-core'

export function solscanTx(sig: string): string {
  return `https://solscan.io/tx/${sig}`
}

export function hash(str: string): number {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
export function b58(r: () => number, n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) s += ALPHA[Math.floor(r() * ALPHA.length)]
  return s
}
