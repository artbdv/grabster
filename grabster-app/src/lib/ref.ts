const KEY = 'grabster.ref.v1'
const DAYS = 30

export function rememberRef(code: string) {
  const value = (code || '').trim()
  if (value.length < 6) return
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(KEY, JSON.stringify({ code: value, at: Date.now() }))
}

export function storedRef(): string {
  if (typeof localStorage === 'undefined') return ''
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return ''
    const row = JSON.parse(raw) as { code?: string; at?: number }
    if (!row.code || typeof row.at !== 'number') return ''
    if (Date.now() - row.at > DAYS * 86_400_000) return ''
    return row.code
  } catch {
    return ''
  }
}
