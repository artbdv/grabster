import { Keypair, Transaction } from '@solana/web3.js'
import { b64ToBytes, bytesToB64, inspectPlan, type PlanResponse } from '@grabster/solana-core'

export function inspectOrThrow(plan: PlanResponse, owner: string) {
  const r = inspectPlan(plan.txs, owner)
  if (!r.ok) throw new Error(r.reason)
}

export function signWithSecret(plan: PlanResponse, secret: Uint8Array): string[] {
  const kp = Keypair.fromSecretKey(secret)
  if (kp.publicKey.toBase58() !== plan.address) {
    throw new Error('This key does not match the wallet we scanned.')
  }
  inspectOrThrow(plan, plan.address)
  return plan.txs.map((row) => {
    const tx = Transaction.from(b64ToBytes(row.tx))
    tx.partialSign(kp)
    return bytesToB64(tx.serialize({ requireAllSignatures: false }))
  })
}

export async function signWithAdapter(
  plan: PlanResponse,
  owner: string,
  signAll: (txs: Transaction[]) => Promise<Transaction[]>,
): Promise<string[]> {
  inspectOrThrow(plan, owner)
  const unsigned = plan.txs.map((row) => Transaction.from(b64ToBytes(row.tx)))
  const signed = await signAll(unsigned)
  return signed.map((tx) => bytesToB64(tx.serialize({ requireAllSignatures: false })))
}
