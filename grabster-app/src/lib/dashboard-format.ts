/** Display helpers for the ops dashboard. Numbers come from GET /v1/ops only. */

export type DashPeriod = '7d' | '30d' | '90d'

export function shortDay(iso: string): string {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export function shortWhen(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

export function pct(n: number): string {
  const sign = n > 0 ? '+' : ''
  return `${sign}${(n * 100).toFixed(1)}%`
}
