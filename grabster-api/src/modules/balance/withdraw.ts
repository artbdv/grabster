import { PublicKey, SystemProgram } from '@solana/web3.js'
import { solToLamports } from '@grabster/solana-core'
import { env } from '../../shared/env'
import {
  attachSignatures,
  bookWithdraw,
  markFailed,
  markRowAvailable,
  totalsFor,
  withdrawUsedToday,
} from '../../shared/ledger'
import { rpc, withRpc } from '../../shared/rpc'
import { buildTx, latestBlockhash, priorityMicroLamports, treasuryKeypair } from '../../shared/tx'

const RENT_BUFFER = 1_000_000

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status })
}

function vaultKey() {
  if (!env.vault || !env.vaultSecret) fail('Withdraw is not configured.', 503)
  const key = treasuryKeypair(env.vaultSecret)
  if (key.publicKey.toBase58() !== env.vault) fail('Withdraw is not configured.', 503)
  return key
}

export function withdrawRules() {
  return {
    minSol: env.withdrawMinSol,
    feeSol: env.withdrawFeeSol,
    dailySol: env.withdrawDailySol,
    minLamports: solToLamports(env.withdrawMinSol),
    feeLamports: solToLamports(env.withdrawFeeSol),
    dailyLamports: solToLamports(env.withdrawDailySol),
  }
}

export async function withdrawQuote(owner: string) {
  const rules = withdrawRules()
  const totals = await totalsFor(owner)
  const available = Math.max(0, totals.credit - totals.withdrawn)
  const used = await withdrawUsedToday(owner)
  const left = Math.max(0, rules.dailyLamports - used)
  const max = Math.min(available, left)
  return {
    ...rules,
    available,
    used,
    left,
    max,
    can: max >= rules.minLamports && Boolean(env.vault && env.vaultSecret),
    availableSol: available / 1e9,
    usedSol: used / 1e9,
    leftSol: left / 1e9,
    maxSol: max / 1e9,
  }
}

export async function withdrawToOwner(owner: string, sol: number) {
  const rules = withdrawRules()
  const amount = solToLamports(sol)
  if (amount < rules.minLamports) fail(`Minimum withdraw is ${env.withdrawMinSol} SOL.`)
  const net = amount - rules.feeLamports
  if (net <= 0) fail(`Minimum withdraw is ${env.withdrawMinSol} SOL.`)

  const vault = vaultKey()
  const dest = new PublicKey(owner)
  const vaultLamports = await withRpc(() => rpc().getBalance(vault.publicKey))
  if (vaultLamports < net + RENT_BUFFER) fail('Vault is short on SOL. Try again later.', 503)

  const booked = await bookWithdraw({
    owner,
    lamports: amount,
    note: `Withdraw to ${owner}`,
    minLamports: rules.minLamports,
    dailyLamports: rules.dailyLamports,
  })
  let signature = ''
  try {
    const blockhash = await latestBlockhash()
    const cuPrice = await priorityMicroLamports()
    const tx = buildTx(
      [SystemProgram.transfer({ fromPubkey: vault.publicKey, toPubkey: dest, lamports: net })],
      vault.publicKey,
      blockhash,
      20_000,
      cuPrice,
    )
    tx.sign(vault)
    signature = await withRpc(() => rpc().sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    }))
    await attachSignatures(booked.id, [signature])
    const st = await rpc().getSignatureStatuses([signature])
    const row = st.value?.[0]
    if (row?.err) {
      await markFailed(booked.id)
      fail('The network rejected that payout. Nothing left your book.', 502)
    }
    if (row && (row.confirmationStatus === 'confirmed' || row.confirmationStatus === 'finalized')) {
      await markRowAvailable(booked.id)
    }
    return {
      id: booked.id,
      signature,
      sol: amount / 1e9,
      sentSol: net / 1e9,
      feeSol: rules.feeSol,
    }
  } catch (err) {
    if (!signature) await markFailed(booked.id)
    throw err
  }
}
