import { rpc } from './rpc'

const cache = new Map<number, { value: number; at: number }>()
const TTL = 60_000

export async function rentFor(space: number): Promise<number> {
  const now = Date.now()
  const hit = cache.get(space)
  if (hit && now - hit.at < TTL) return hit.value
  const value = await rpc().getMinimumBalanceForRentExemption(space)
  cache.set(space, { value, at: now })
  return value
}

export async function tokenAccountRent(): Promise<number> {
  return rentFor(165)
}
