import { ComputeBudgetInstruction, ComputeBudgetProgram, SystemInstruction, SystemProgram, Transaction } from '@solana/web3.js'
import {
  decodeInstruction,
  decodeTransferCheckedWithFeeInstructionUnchecked,
  isBurnCheckedInstruction,
  isCloseAccountInstruction,
  isTransferCheckedInstruction,
} from '@solana/spl-token'
import { BURN_NFT_DISCRIMINATOR, BURN_V1_DISCRIMINATOR } from './nft'
import { ALLOWED_PROGRAMS, LIGHTHOUSE_PROGRAM, PROGRAMS, WITHDRAW_EXCESS_DISCRIMINATOR } from './programs'
import type { PlannedTx } from './types'
import { b64ToBytes } from './bytes'

export type InspectResult = { ok: true } | { ok: false; reason: string }

function programOf(ix: { programId: { toBase58(): string } }): string {
  return ix.programId.toBase58()
}

function asFeeSweep(ix: Transaction['instructions'][number]): { src: string; dest: string } | null {
  try {
    const fee = decodeTransferCheckedWithFeeInstructionUnchecked(ix)
    const src = fee.keys.source?.pubkey.toBase58()
    const dest = fee.keys.destination?.pubkey.toBase58()
    if (!src || !dest) return null
    return { src, dest }
  } catch {
    return null
  }
}

/** Compute-unit limit and price set by a transaction (undefined when it doesn't set them). */
function budgetOf(tx: Transaction): { limit?: number; price?: bigint; ok: boolean } {
  const out: { limit?: number; price?: bigint; ok: boolean } = { ok: true }
  for (const ix of tx.instructions) {
    if (!ix.programId.equals(ComputeBudgetProgram.programId)) continue
    try {
      const kind = ComputeBudgetInstruction.decodeInstructionType(ix)
      if (kind === 'SetComputeUnitLimit') out.limit = ComputeBudgetInstruction.decodeSetComputeUnitLimit(ix).units
      else if (kind === 'SetComputeUnitPrice') out.price = BigInt(ComputeBudgetInstruction.decodeSetComputeUnitPrice(ix).microLamports)
    } catch {
      out.ok = false
    }
  }
  return out
}

export function inspectTransaction(txB64: string, expected: PlannedTx, owner: string): InspectResult {
  let tx: Transaction
  try {
    tx = Transaction.from(b64ToBytes(txB64))
  } catch {
    return { ok: false, reason: 'Could not decode the transaction.' }
  }

  const desc = expected.description
  const sweepAccounts = desc.sweepAccounts || []
  const sinkAtas = desc.sinkAtas || []
  const sweepsExpected = desc.sweeps ?? 0
  const nftsExpected = desc.nfts ?? 0
  const nftAccounts = desc.nftAccounts || []
  const nftMetas = desc.nftMetas || []
  const refundAccounts = desc.refundAccounts || []
  const refundsExpected = desc.refunds ?? 0
  let closes = 0
  let burns = 0
  let sweeps = 0
  let nfts = 0
  let refunds = 0
  let feePaid = 0
  let remainderPaid = 0
  let creditPaid = 0

  for (const ix of tx.instructions) {
    const pid = programOf(ix)
    if (pid === LIGHTHOUSE_PROGRAM) {
      // Wallet-added assertions are fine; nothing there may spend from the treasury.
      if (desc.feeTo && ix.keys.some((k) => k.isSigner && k.pubkey.toBase58() === desc.feeTo)) {
        return { ok: false, reason: 'Unexpected instruction signed by Grabster.' }
      }
      continue
    }
    if (!ALLOWED_PROGRAMS.has(pid)) {
      return { ok: false, reason: `Unexpected program ${pid}` }
    }

    if (pid === PROGRAMS.COMPUTE) continue

    if (pid === PROGRAMS.SYSTEM) {
      if (ix.programId.equals(SystemProgram.programId)) {
        let from: string
        let to: string
        let lamports: number
        try {
          const tr = SystemInstruction.decodeTransfer(ix)
          from = tr.fromPubkey.toBase58()
          to = tr.toPubkey.toBase58()
          lamports = Number(tr.lamports)
        } catch {
          return { ok: false, reason: 'Unexpected System Program instruction.' }
        }
        // Grabster (feeTo is the treasury) may only send the planned leftover credit, and only to creditTo.
        if (desc.feeTo && from === desc.feeTo) {
          if (!desc.creditTo || to !== desc.creditTo) return { ok: false, reason: 'Unexpected transfer from Grabster.' }
          creditPaid += lamports
          continue
        }
        // Every other SOL movement comes from the wallet owner: the fee and the remainder.
        if (from !== owner) return { ok: false, reason: 'SOL transfers must come from the wallet owner.' }
        if (desc.feeTo && to === desc.feeTo) {
          const take = Math.min(Math.max(0, desc.feeLamports - feePaid), lamports)
          feePaid += take
          lamports -= take
          if (lamports === 0) continue
        }
        if (desc.remainderTo && to === desc.remainderTo) {
          remainderPaid += lamports
          continue
        }
        if (lamports > 0) return { ok: false, reason: `Unexpected SOL transfer to ${to}` }
        continue
      }
    }

    if (pid === PROGRAMS.TOKEN || pid === PROGRAMS.TOKEN_2022) {
      if (ix.data[0] === WITHDRAW_EXCESS_DISCRIMINATOR) {
        const src = ix.keys[0]?.pubkey.toBase58()
        const dest = ix.keys[1]?.pubkey.toBase58()
        if (!src || !refundAccounts.includes(src)) {
          return { ok: false, reason: 'Taking extra deposit from an account that was not in the plan.' }
        }
        if (dest !== desc.closeDestination) {
          return { ok: false, reason: 'Extra deposit destination does not match the plan.' }
        }
        refunds++
        continue
      }
      try {
        const decoded = decodeInstruction(ix, ix.programId)
        if (isCloseAccountInstruction(decoded)) {
          const dest = decoded.keys.destination.pubkey.toBase58()
          if (dest !== desc.closeDestination) {
            return { ok: false, reason: 'Close destination does not match the plan.' }
          }
          const acc = decoded.keys.account.pubkey.toBase58()
          if (!desc.closeAccounts.includes(acc)) {
            return { ok: false, reason: 'Closing an account that was not in the plan.' }
          }
          closes++
          continue
        }
        if (isBurnCheckedInstruction(decoded)) {
          const acc = decoded.keys.account.pubkey.toBase58()
          if (!desc.burnAccounts.includes(acc)) {
            return { ok: false, reason: 'Burning an account that was not in the plan.' }
          }
          burns++
          continue
        }
        if (isTransferCheckedInstruction(decoded) || asFeeSweep(ix)) {
          const pair = isTransferCheckedInstruction(decoded)
            ? { src: decoded.keys.source.pubkey.toBase58(), dest: decoded.keys.destination.pubkey.toBase58() }
            : asFeeSweep(ix)!
          if (!sweepAccounts.includes(pair.src)) {
            return { ok: false, reason: 'Moving leftovers from an account that was not in the plan.' }
          }
          if (!sinkAtas.includes(pair.dest)) {
            return { ok: false, reason: 'Leftovers must go to a Grabster sink.' }
          }
          sweeps++
          continue
        }
        return { ok: false, reason: 'Unexpected token instruction.' }
      } catch {
        const pair = asFeeSweep(ix)
        if (!pair) return { ok: false, reason: 'Could not read a token instruction.' }
        if (!sweepAccounts.includes(pair.src)) {
          return { ok: false, reason: 'Moving leftovers from an account that was not in the plan.' }
        }
        if (!sinkAtas.includes(pair.dest)) {
          return { ok: false, reason: 'Leftovers must go to a Grabster sink.' }
        }
        sweeps++
        continue
      }
    }

    if (pid === PROGRAMS.ATA) {
      const ata = ix.keys[1]?.pubkey.toBase58()
      if (!ata || !sinkAtas.includes(ata)) {
        return { ok: false, reason: 'Unexpected associated-token account.' }
      }
      continue
    }

    if (pid === PROGRAMS.METADATA) {
      const disc = ix.data[0]
      const v1 = disc === BURN_V1_DISCRIMINATOR
      if (disc !== BURN_NFT_DISCRIMINATOR && !v1) {
        return { ok: false, reason: 'Unexpected metadata instruction.' }
      }
      const token = ix.keys[v1 ? 5 : 3]?.pubkey.toBase58()
      const meta = ix.keys[v1 ? 2 : 0]?.pubkey.toBase58()
      if (!token || !nftAccounts.includes(token)) {
        return { ok: false, reason: 'Burning an NFT that was not in the plan.' }
      }
      if (!meta || !nftMetas.includes(meta)) {
        return { ok: false, reason: 'Unexpected NFT metadata account.' }
      }
      nfts++
      continue
    }

    if (pid === PROGRAMS.MEMO) {
      return { ok: false, reason: 'This release does not include that instruction.' }
    }
  }

  if (closes !== desc.closes) return { ok: false, reason: 'Close count does not match the plan.' }
  if (burns !== desc.burns) return { ok: false, reason: 'Burn count does not match the plan.' }
  if (sweeps !== sweepsExpected) return { ok: false, reason: 'Sweep count does not match the plan.' }
  if (nfts !== nftsExpected) return { ok: false, reason: 'NFT burn count does not match the plan.' }
  if (refunds !== refundsExpected) return { ok: false, reason: 'Extra-deposit count does not match the plan.' }
  // Exact amounts: the server books credit and referral shares from the plan, so the signed
  // transaction must move exactly what the plan says — not less, not more.
  if (feePaid !== desc.feeLamports) return { ok: false, reason: 'Fee does not match the plan.' }
  if (remainderPaid !== (desc.remainderTo ? (desc.remainderLamports ?? 0) : 0)) {
    return { ok: false, reason: 'Remainder transfer does not match the plan.' }
  }
  if (creditPaid !== (desc.creditLamports ?? 0)) {
    return { ok: false, reason: 'Leftover credit does not match the plan.' }
  }

  const feePayer = tx.feePayer?.toBase58()
  if (feePayer && feePayer !== owner && feePayer !== desc.feeTo) {
    return { ok: false, reason: 'Unexpected fee payer.' }
  }
  // The planned transaction fixes who pays network fees and how much priority it buys.
  let planned: Transaction | null = null
  try {
    planned = Transaction.from(b64ToBytes(expected.tx))
  } catch {
    planned = null
  }
  const plannedPayer = planned?.feePayer?.toBase58()
  if (plannedPayer && feePayer !== plannedPayer) {
    return { ok: false, reason: 'Fee payer does not match the plan.' }
  }
  if (desc.feeTo && feePayer === desc.feeTo) {
    // Grabster pays this transaction's fees: the wallet can't raise the compute budget it pays for.
    const want = planned ? budgetOf(planned) : { ok: true }
    const got = budgetOf(tx)
    if (!got.ok) return { ok: false, reason: 'Unexpected compute-budget instruction.' }
    const wantPrice = 'price' in want && want.price !== undefined ? want.price : 0n
    const wantLimit = 'limit' in want && want.limit !== undefined ? want.limit : 0
    if ((got.price ?? 0n) > wantPrice) return { ok: false, reason: 'Priority fee is higher than planned.' }
    if ((got.price ?? 0n) > 0n && (got.limit === undefined || got.limit > wantLimit)) {
      return { ok: false, reason: 'Compute limit is higher than planned.' }
    }
  }

  return { ok: true }
}

export function inspectPlan(txs: PlannedTx[], owner: string): InspectResult {
  for (const planned of txs) {
    const r = inspectTransaction(planned.tx, planned, owner)
    if (!r.ok) return r
  }
  return { ok: true }
}
