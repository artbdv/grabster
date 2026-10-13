import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import { TX_SIZE_SAFE } from './programs'

export function txSize(tx: Transaction): number {
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length
}

export function buildTx(
  ixs: TransactionInstruction[],
  feePayer: PublicKey,
  blockhash: string,
  cuLimit: number,
  cuPrice: number,
): Transaction {
  const tx = new Transaction()
  tx.feePayer = feePayer
  tx.recentBlockhash = blockhash
  tx.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cuPrice }),
    ...ixs,
  )
  return tx
}

export function fits(
  ixs: TransactionInstruction[],
  feePayer: PublicKey,
  blockhash: string,
  cuLimit: number,
  cuPrice: number,
): boolean {
  try {
    return txSize(buildTx(ixs, feePayer, blockhash, cuLimit, cuPrice)) <= TX_SIZE_SAFE
  } catch {
    return false
  }
}
