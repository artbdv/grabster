const AT = 'grabster_at'
const RT = 'grabster_rt'
const ADDR = 'grabster_addr'

function storeGet(name: string): string {
  if (typeof localStorage === 'undefined') return ''
  try { return localStorage.getItem(name) || '' } catch { return '' }
}

function storeSet(name: string, value: string) {
  if (typeof localStorage === 'undefined') return
  try {
    if (value) localStorage.setItem(name, value)
    else localStorage.removeItem(name)
  } catch { /* private mode */ }
}

export function accessToken(): string {
  return storeGet(AT)
}

export function refreshToken(): string {
  return storeGet(RT)
}

export function sessionAddress(): string {
  return storeGet(ADDR)
}

export function setSessionAddress(address: string) {
  storeSet(ADDR, address)
}

export function setAuthCookies(access: string, refresh: string) {
  storeSet(AT, access)
  storeSet(RT, refresh)
}

export function clearAuthCookies() {
  storeSet(AT, '')
  storeSet(RT, '')
  storeSet(ADDR, '')
}
