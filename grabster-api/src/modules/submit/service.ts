import { Transaction } from '@solana/web3.js'
import type { PoolClient } from 'pg'
import bs58 from 'bs58'
import { inspectTransaction, type PlanResponse, type SubmitResponse } from '@grabster/solana-core'
import { env } from '../../shared/env'
import { db, dbOn } from '../../shared/db'
import { recordCleanup, type CleanupChannel } from '../../shared/cleanup'
import { bookCredit } from '../../shared/ledger'
import { creditReferrer } from '../../shared/referral'
import { rpc } from '../../shared/rpc'
import { treasuryKeypair } from '../../shared/tx'
import { getPlan } from '../plan/store'

function isExpiredBlockhash(err: unknown): boolean {
  const text = err instanceof Error ? `${err.message} ${'logs' in err ? String((err as { logs?: string[] }).logs) : ''}` : String(err)
  return /blockhash not found|BlockhashNotFound|TransactionExpiredBlockheightExceeded|block height exceeded|blockhash expired/i.test(text)
}

function rebuildError(message: string, signatures: string[]) {
  return Object.assign(new Error(message), {
    status: 409,
    code: 'blockhash_expired',
    signatures,
  })
}

/** Per transaction: what it credits to the Grabster balance, and Grabster's service fee in it. */
function txShares(plan: PlanResponse, n: number) {
  const credit: number[] = []
  const fee: number[] = []
  for (const t of plan.txs.slice(0, n)) {
    const d = t.description
    credit.push((d.remainderLamports ?? 0) + (d.balanceCreditLamports ?? 0))
    fee.push(d.serviceFeeLamports ?? d.feeLamports)
  }
  return { credit, fee }
}

/**
 * Books the balance credit as pending with per-signature amounts; settlePending pays only what confirms,
 * so a transaction dropped near blockhash expiry is never credited (the rebuilt plan covers it).
 */
async function bookPlanCredit(plan: PlanResponse, signatures: string[], owner: string, parts: number[], partial: boolean) {
  const lamports = parts.reduce((s, x) => s + x, 0)
  if (plan.dest !== 'balance' || !env.features.balance || lamports <= 0 || !signatures.length) return
  try {
    await bookCredit({
      owner,
      lamports,
      planId: plan.planId,
      signatures,
      parts,
      note: partial ? 'Grab to Grabster balance (part of a plan that stopped)' : undefined,
    })
  } catch (err) {
    console.warn('Ledger book failed', err)
  }
}

async function bookReferral(plan: PlanResponse, signatures: string[], ref: string | undefined, feeParts: number[]) {
  if (!ref || !signatures.length) return
  try {
    await creditReferrer({ referee: plan.address, code: ref, feeParts, planId: plan.planId, signatures })
  } catch (err) {
    console.warn('Referral book failed', err)
  }
}

/** Same-process guard; Postgres advisory lock covers multiple API instances when the DB is up. */
const sending = new Set<string>()

async function withSendLock<T>(planId: string, fn: () => Promise<T>): Promise<T> {
  if (sending.has(planId)) {
    throw Object.assign(new Error('This plan is already being sent.'), { status: 423 })
  }
  sending.add(planId)
  if (!dbOn()) {
    try {
      return await fn()
    } finally {
      sending.delete(planId)
    }
  }
  const key = `grabster:submit:${planId}`
  let client: PoolClient | undefined
  try {
    client = await db().connect()
    const { rows } = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [key])
    if (!rows[0]?.ok) {
      throw Object.assign(new Error('This plan is already being sent.'), { status: 423 })
    }
    try {
      return await fn()
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]).catch(() => {})
    }
  } finally {
    client?.release()
    sending.delete(planId)
  }
}

export async function submitPlan(
  planId: string,
  signed: string[],
  ref?: string,
  creditOwner?: string,
  channel: CleanupChannel = 'web',
): Promise<SubmitResponse> {
  const plan = getPlan(planId)
  if (!plan) throw rebuildError('Plan expired. Build it again.', [])
  if (signed.length !== plan.txs.length) {
    throw Object.assign(new Error('Signed transaction count does not match the plan.'), { status: 400 })
  }
  if (plan.dest === 'balance' && env.features.balance && plan.netLamports > 0 && !creditOwner) {
    throw Object.assign(new Error('Sign in first so leftovers land in your Grabster balance.'), { status: 401 })
  }

  const treasury = plan.needsTreasurySig
    ? treasuryKeypair(env.treasurySecret)
    : null

  // Check, co-sign and serialize every transaction before sending any, so nothing goes out half-way
  // because a later one is wrong or unsigned.
  const ready: { raw: Buffer; sig: string }[] = []
  for (let i = 0; i < signed.length; i++) {
    const checked = inspectTransaction(signed[i], plan.txs[i], plan.address)
    if (!checked.ok) {
      throw Object.assign(new Error(checked.reason || 'Signed transaction does not match the one we built.'), { status: 400 })
    }
    try {
      const tx = Transaction.from(Buffer.from(signed[i], 'base64'))
      // Only transactions that list the treasury as a signer need its signature (partialSign throws otherwise).
      if (treasury && tx.signatures.some((x) => x.publicKey.equals(treasury.publicKey))) tx.partialSign(treasury)
      const raw = tx.serialize()
      ready.push({ raw, sig: bs58.encode(tx.signature!) })
    } catch {
      throw Object.assign(new Error('A transaction is missing a signature or does not verify.'), { status: 400 })
    }
  }

  return withSendLock(planId, async () => {
    const signatures: string[] = []
    try {
      for (const { raw } of ready) {
        const sig = await rpc().sendRawTransaction(raw, {
          skipPreflight: false,
          maxRetries: 3,
        })
        signatures.push(sig)
      }
    } catch (err) {
      // Transactions that already went out moved real SOL: credit their share, and tell the client which ones they were.
      // The one whose send threw may still land, so its precomputed signature is booked too; settlement only pays what confirms.
      const attempted = signatures.length < ready.length
        ? [...signatures, ready[signatures.length].sig]
        : signatures
      if (attempted.length) {
        const share = txShares(plan, attempted.length)
        if (creditOwner) await bookPlanCredit(plan, attempted, creditOwner, share.credit, true)
        await bookReferral(plan, attempted, ref, share.fee)
        await recordCleanup({ plan, signatures: attempted, channel, partial: true })
      }
      // Tell the client every signature we booked (including the in-flight send) so the UI can watch them.
      if (isExpiredBlockhash(err)) {
        throw rebuildError('The network blockhash expired. Sign the remaining transactions again.', attempted)
      }
      throw Object.assign(err instanceof Error ? err : new Error(String(err)), { signatures: attempted })
    }

    const share = txShares(plan, plan.txs.length)
    if (creditOwner) await bookPlanCredit(plan, signatures, creditOwner, share.credit, false)
    await bookReferral(plan, signatures, ref, share.fee)
    await recordCleanup({ plan, signatures, channel, partial: false })
    return { signatures }
  })
}
