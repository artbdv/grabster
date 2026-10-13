import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js'
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createBurnCheckedInstruction,
  createCloseAccountInstruction,
} from '@solana/spl-token'
import {
  WSOL_MINT,
  isProtectedMint,
  lamportsToSol,
} from '@grabster/solana-core'
import { env } from '../../shared/env'
import { executeSwap, fetchSwapOrder } from '../../shared/jupiter'
import { rpc, withRpc } from '../../shared/rpc'
import {
  dropMint,
  listedSymbol,
  markSwapFail,
  markSwapOk,
} from '../../shared/sink-allow'
import { buildTx, latestBlockhash, priorityMicroLamports, treasuryKeypair } from '../../shared/tx'

interface Holding {
  address: string
  mint: string
  program: 'token' | 'token2022'
  amount: bigint
  decimals: number
  native: boolean
  frozen: boolean
  delegate: string
}

let running = false

function programId(h: Holding) {
  return h.program === 'token2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
}

function label(mint: string): string {
  return listedSymbol(mint) || `${mint.slice(0, 4)}…${mint.slice(-4)}`
}

export function swpEnabled(): boolean {
  return Boolean(env.features.swp && env.treasury && env.treasurySecret && env.jupiterKey)
}

export function startSwpLoop(): void {
  if (!swpEnabled()) {
    console.log('swp: off (need FEATURE_SWP, treasury key, and Jupiter key)')
    return
  }
  const delay = Math.max(5_000, env.swpStartDelayMs)
  const every = Math.max(30_000, env.swpIntervalMs)
  console.log(`swp: first pass in ${Math.round(delay / 1000)}s, then every ${Math.round(every / 1000)}s`)
  setTimeout(() => {
    void runSwpPass()
    setInterval(() => { void runSwpPass() }, every)
  }, delay)
}

export async function runSwpPass(): Promise<void> {
  if (!swpEnabled() || running) return
  running = true
  try {
    const treasury = treasuryKeypair(env.treasurySecret)
    if (treasury.publicKey.toBase58() !== env.treasury) {
      console.warn('swp: treasury key does not match TREASURY_ADDRESS — skip')
      return
    }
    const holdings = await loadHoldings(treasury.publicKey)
    let sold = 0
    let burned = 0
    let closed = 0
    for (const row of holdings) {
      const result = await handleHolding(row, treasury)
      if (result === 'sold') sold++
      else if (result === 'burned') burned++
      else if (result === 'closed') closed++
      await sleep(400)
    }
    if (sold || burned || closed) {
      console.log(`swp: pass done — sold ${sold}, burned ${burned}, closed empty ${closed}`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`swp: pass failed (${message})`)
  } finally {
    running = false
  }
}

async function handleHolding(row: Holding, treasury: Keypair): Promise<'sold' | 'burned' | 'closed' | 'skip'> {
  if (row.frozen || row.delegate) return 'skip'
  if (isProtectedMint(row.mint)) return 'skip'
  if (row.amount === 0n || row.native) {
    if (await closeEmpty(row, treasury)) return 'closed'
    return 'skip'
  }

  const { order, noRoute } = await fetchSwapOrder({
    inputMint: row.mint,
    outputMint: WSOL_MINT,
    amount: row.amount.toString(),
    taker: treasury.publicKey.toBase58(),
  })

  if (order) {
    const signed = signOrder(order.transaction, treasury)
    if (!signed) {
      console.warn(`swp: could not sign Jupiter order for ${label(row.mint)}`)
      return 'skip'
    }
    const exec = await executeSwap(signed, order.requestId)
    if (exec.ok) {
      await markSwapOk(row.mint)
      const sol = exec.outAmount ? lamportsToSol(Number(exec.outAmount)) : 0
      console.log(`swp: sold ${label(row.mint)} → ${sol ? `${sol} SOL` : 'SOL'}`)
      const left = await refreshAmount(row)
      if (left === 0n) await closeEmpty(row, treasury)
      return 'sold'
    }
    console.warn(`swp: Jupiter execute failed for ${label(row.mint)}`)
    return 'skip'
  }

  if (!noRoute) {
    console.warn(`swp: Jupiter order failed for ${label(row.mint)}`)
    return 'skip'
  }

  const fails = await markSwapFail(row.mint)
  if (fails < env.swpFailsBeforeBurn) {
    console.log(`swp: no route for ${label(row.mint)} (${fails}/${env.swpFailsBeforeBurn})`)
    return 'skip'
  }
  if (await burnAndDrop(row, treasury)) return 'burned'
  return 'skip'
}

function signOrder(txB64: string, treasury: Keypair): string | null {
  try {
    const tx = VersionedTransaction.deserialize(Buffer.from(txB64, 'base64'))
    tx.sign([treasury])
    return Buffer.from(tx.serialize()).toString('base64')
  } catch {
    return null
  }
}

async function burnAndDrop(row: Holding, treasury: Keypair): Promise<boolean> {
  try {
    const owner = treasury.publicKey
    const ata = new PublicKey(row.address)
    const mint = new PublicKey(row.mint)
    const ixs = [
      createBurnCheckedInstruction(ata, mint, owner, row.amount, row.decimals, [], programId(row)),
      createCloseAccountInstruction(ata, owner, owner, [], programId(row)),
    ]
    const [blockhash, cuPrice] = await Promise.all([latestBlockhash(), priorityMicroLamports()])
    const tx = buildTx(ixs, owner, blockhash, 80_000, cuPrice)
    tx.sign(treasury)
    const sig = await withRpc(() => rpc().sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 }))
    await rpc().confirmTransaction(sig, 'confirmed')
    await dropMint(row.mint)
    console.log(`swp: burned illiquid ${label(row.mint)} and dropped it from the sink list`)
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`swp: burn failed for ${label(row.mint)} (${message})`)
    return false
  }
}

async function closeEmpty(row: Holding, treasury: Keypair): Promise<boolean> {
  try {
    const owner = treasury.publicKey
    const ixs = [createCloseAccountInstruction(new PublicKey(row.address), owner, owner, [], programId(row))]
    const [blockhash, cuPrice] = await Promise.all([latestBlockhash(), priorityMicroLamports()])
    const tx = buildTx(ixs, owner, blockhash, 40_000, cuPrice)
    tx.sign(treasury)
    const sig = await withRpc(() => rpc().sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 }))
    await rpc().confirmTransaction(sig, 'confirmed')
    return true
  } catch {
    return false
  }
}

async function refreshAmount(row: Holding): Promise<bigint> {
  try {
    const info = await withRpc(() => rpc().getParsedAccountInfo(new PublicKey(row.address)))
    const parsed = (info.value?.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } } | undefined)?.parsed
    const amount = parsed?.info?.tokenAmount?.amount
    return amount ? BigInt(amount) : 0n
  } catch {
    return 0n
  }
}

async function loadHoldings(owner: PublicKey): Promise<Holding[]> {
  const [token, token2022] = await Promise.all([
    fetchProgram(owner, 'token'),
    fetchProgram(owner, 'token2022'),
  ])
  return [...token, ...token2022]
}

async function fetchProgram(owner: PublicKey, program: 'token' | 'token2022'): Promise<Holding[]> {
  const programId = program === 'token' ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID
  const res = await withRpc(() => rpc().getParsedTokenAccountsByOwner(owner, { programId }))
  return res.value.flatMap(({ pubkey, account }) => {
    const info = (account.data as { parsed?: { info?: {
      mint?: string
      tokenAmount?: { amount: string; decimals: number }
      state?: string
      isNative?: boolean | { amount?: string }
      delegate?: string
    } } }).parsed?.info
    if (!info?.mint || !info.tokenAmount) return []
    const native = info.isNative === true || (typeof info.isNative === 'object' && !!info.isNative)
    return [{
      address: pubkey.toBase58(),
      mint: info.mint,
      program,
      amount: BigInt(info.tokenAmount.amount),
      decimals: info.tokenAmount.decimals,
      native,
      frozen: info.state === 'frozen',
      delegate: info.delegate || '',
    }]
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
