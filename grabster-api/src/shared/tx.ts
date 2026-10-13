import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { rpc, withRpc } from './rpc'

export { buildTx, fits, txSize } from '@grabster/solana-core'

export async function latestBlockhash(): Promise<string> {
  return withRpc(async () => {
    const { blockhash } = await rpc().getLatestBlockhash('finalized')
    return blockhash
  })
}

export async function priorityMicroLamports(): Promise<number> {
  try {
    const fees = await rpc().getRecentPrioritizationFees()
    if (!fees.length) return 1_000
    const sorted = fees.map((f) => f.prioritizationFee).sort((a, b) => a - b)
    const mid = sorted[Math.floor(sorted.length / 2)] ?? 0
    return Math.min(50_000, Math.max(1_000, mid || 1_000))
  } catch {
    return 1_000
  }
}

export function treasuryKeypair(secret: string): Keypair {
  try {
    const arr = JSON.parse(secret) as number[]
    return Keypair.fromSecretKey(Uint8Array.from(arr))
  } catch {
    return Keypair.fromSecretKey(bs58.decode(secret))
  }
}
