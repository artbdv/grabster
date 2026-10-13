import { PublicKey, TransactionInstruction } from '@solana/web3.js'
import { solToLamports } from './format'
import {
  BASE_FEE_LAMPORTS,
  ESTIMATED_GAS_SOL,
  REFUND_PER_BATCH,
  WITHDRAW_EXCESS_DISCRIMINATOR,
} from './programs'
import type { TokenBox } from './types'

/** Skip a box if the extra deposit is smaller than two base signatures. */
export const MIN_EXCESS_LAMPORTS = BASE_FEE_LAMPORTS * 2

/** Token-2022 CPI Guard can block this; native wSOL rejects it. */
export function canRefundExcess(box: TokenBox): boolean {
  if (box.native || !(box.excessLamports >= MIN_EXCESS_LAMPORTS)) return false
  const ext = box.extensions.join(' ').toLowerCase()
  if (ext.includes('cpiguard')) return false
  return true
}

/** REF-3: only refund when the pile covers 2× estimated network fees for those txs. */
export function refundWorthIt(
  excessLamports: number,
  boxes: number,
  gasSol = ESTIMATED_GAS_SOL,
): boolean {
  if (boxes <= 0 || excessLamports <= 0) return false
  const txs = Math.max(1, Math.ceil(boxes / REFUND_PER_BATCH))
  return excessLamports >= solToLamports(gasSol * 2 * txs)
}

export function withdrawExcessInstruction(
  source: PublicKey,
  destination: PublicKey,
  authority: PublicKey,
  programId: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([WITHDRAW_EXCESS_DISCRIMINATOR]),
  })
}
