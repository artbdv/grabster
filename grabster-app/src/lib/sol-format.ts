/**
 * Balance figures: always four decimals ("0.0000", "1.2500"), rounded down so a balance is never
 * overstated, and a tiny positive amount shows as "<0.0001" rather than a false zero.
 */
export function fmtBalance(sol: number): string {
  if (!Number.isFinite(sol) || sol <= 0) return '0.0000'
  if (sol < 0.0001) return '<0.0001'
  const floored = Math.floor(sol * 1e4 + 1e-9) / 1e4
  return floored.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}

/** Full precision for a tooltip: up to 9 decimals, trailing zeros dropped. */
export function fullSol(sol: number): string {
  return `${(Number.isFinite(sol) ? sol : 0).toLocaleString('en-US', { maximumFractionDigits: 9 })} SOL`
}
