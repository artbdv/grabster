/** In-memory only. Never write a key to localStorage or the reactive store. */
const byAddr = new Map<string, Uint8Array>()

export function rememberSecret(addr: string, secret: Uint8Array) {
  byAddr.set(addr, secret)
}

export function secretFor(addr: string): Uint8Array | undefined {
  return byAddr.get(addr)
}

export function forgetSecret(addr: string) {
  byAddr.delete(addr)
}

export function forgetSecrets() {
  byAddr.clear()
}
