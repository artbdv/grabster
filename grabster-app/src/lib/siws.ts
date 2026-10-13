import bs58 from 'bs58'
import { fetchAuthChallenge, fetchAuthVerify, fetchAuthLogout, fetchLedger, fetchWithdraw, type BalanceBook } from './api'
import { setAuthCookies } from './auth-cookies'
import { signMessageWallet } from './wallet'

export async function loginWithWallet(address: string): Promise<string> {
  const { message } = await fetchAuthChallenge(address)
  const sig = await signMessageWallet(new TextEncoder().encode(message))
  const pair = await fetchAuthVerify({ address, message, signature: bs58.encode(sig) })
  setAuthCookies(pair.accessToken, pair.refreshToken)
  return pair.address
}

export async function logoutSession() {
  await fetchAuthLogout()
}

export async function requestWithdraw(sol: number) {
  return fetchWithdraw(sol)
}

const bookListeners = new Set<(book: BalanceBook) => void>()

/** Called with every balance book loaded anywhere, so the header shows the same figure as Profile. */
export function onBook(fn: (book: BalanceBook) => void): () => void {
  bookListeners.add(fn)
  return () => bookListeners.delete(fn)
}

export async function loadBook(): Promise<BalanceBook> {
  const book = await fetchLedger()
  bookListeners.forEach((fn) => fn(book))
  return book
}
