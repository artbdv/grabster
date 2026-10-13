/**
 * Home page first-screen data that isn't live.
 *
 * DEMO_WALLETS: public mainnet addresses with results from real read-only Grabster scans
 * (GET /v1/scan/:address), cached with the check date. The home demo shows them as examples,
 * never as the visitor's wallet. Re-run the scans and update `checkedAt` when refreshing.
 *
 * RENT_STAT: a published, dated estimate of SOL locked in token-account rent. It is kept as
 * separate fields so a live source can replace it later without touching the block.
 */

export interface DemoWallet {
  address: string
  /** Empty token accounts the scan found. */
  empty: number
  /** Their rent, SOL, before fees. */
  emptySol: number
  /** ISO date of the scan. */
  checkedAt: string
}

export const DEMO_WALLETS: DemoWallet[] = [
  { address: 'CA59n4oZNMEdzRPJWjjVEN5SL2kvhkasRMP73SNYh6x4', empty: 152, emptySol: 0.525656246, checkedAt: '2026-10-09' },
  { address: '8uS25b5j4mcFmT5LpMXo4a47f8uf31bDtNoq2KKCePwi', empty: 69, emptySol: 0.110936, checkedAt: '2026-10-09' },
  { address: 'EFg4gSS5JWr3DfXcTwb6QsAvT5ZwHkhkKqRfdVXNzAwG', empty: 305, emptySol: 0.556877, checkedAt: '2026-10-09' },
  { address: '39Ec9X3Wcv6CrFifrGRdMgZxmwimgaCa1SXyoS4WTvky', empty: 19, emptySol: 0.028865, checkedAt: '2026-10-09' },
]

export interface RentStat {
  /** As published, shown in full (≈3,425,000). */
  value: number
  unit: 'SOL'
  /** True while this is a published estimate rather than a live figure. */
  estimate: boolean
  /** ISO month (or date) of the estimate. */
  asOf: string
  sourceUrl: string
}

export const RENT_STAT: RentStat = {
  value: 3_425_000,
  unit: 'SOL',
  estimate: true,
  asOf: '2026-09',
  sourceUrl: 'https://ambcrypto.com/solanas-rent-reform-could-free-3-08m-sol-but-is-it-really-an-airdrop/',
}

/** 3425000 → "3,425,000" (English digit grouping). */
export function groupDigits(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/** "2026-09" → "Sep 2026"; "2026-10-09" → "Oct 9, 2026". */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const month = new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  return d ? `${month} ${d}, ${y}` : `${month} ${y}`
}
