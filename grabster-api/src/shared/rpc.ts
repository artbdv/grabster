import { Connection } from '@solana/web3.js'
import { env } from './env'

let connection: Connection | null = null

export function rpc(): Connection {
  if (!connection) {
    connection = new Connection(env.rpcUrl, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60_000,
    })
  }
  return connection
}

export function isTransientRpc(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|502|503|504|429|Too Many Requests/i.test(msg)
}

export async function withRpc<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown
  for (let i = 0; i < tries; i++) {
    try {
      return await fn()
    } catch (err) {
      last = err
      if (!isTransientRpc(err) || i === tries - 1) throw err
      await new Promise((r) => setTimeout(r, 300 * (i + 1)))
    }
  }
  throw last
}
