/**
 * Regression check for the signed-transaction inspector (money path).
 * Builds real, unsigned plans for a public demo wallet (needs SOLANA_RPC_URL and TREASURY_ADDRESS in .env),
 * then confirms legit transactions pass and tampered ones are rejected. Nothing is signed or sent.
 * Run: npm run check:inspect -w grabster-api
 */
import { ComputeBudgetProgram, PublicKey, SystemInstruction, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js'
import { buildPlan } from '../src/modules/plan/service'
import { inspectTransaction } from '@grabster/solana-core'
import { env } from '../src/shared/env'


const owner = 'CA59n4oZNMEdzRPJWjjVEN5SL2kvhkasRMP73SNYh6x4'
const other = 'CgLY84VptVmSuBkmfiuytgDWzLy9vcmFrU32fvcUnrbs'
const treasury = new PublicKey(env.treasury)
const results: string[] = []
const check = (name: string, ok: boolean) => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}`) }

function retx(b64: string, edit: (tx: Transaction) => void): string {
  const tx = Transaction.from(Buffer.from(b64, 'base64'))
  edit(tx)
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64')
}
const isTransferTo = (ix: Transaction['instructions'][number], to: PublicKey) => {
  if (!ix.programId.equals(SystemProgram.programId)) return false
  try { return SystemInstruction.decodeTransfer(ix).toPubkey.equals(to) } catch { return false }
}

for (const dest of ['same', 'other', 'balance'] as const) {
  const plan = await buildPlan({ address: owner, dest, other: dest === 'other' ? other : undefined, burnDust: false, burnNft: false })
  const legit = plan.txs.every((t) => inspectTransaction(t.tx, t, owner).ok)
  check(`${dest}: all ${plan.txs.length} planned txs pass`, legit)
  const t = plan.txs[plan.txs.length - 1]
  const d = t.description
  // 1. drop the owner → treasury transfer (fee, and for balance also the remainder)
  const noFee = retx(t.tx, (tx) => { tx.instructions = tx.instructions.filter((ix) => !isTransferTo(ix, treasury)) })
  check(`${dest}: dropping the transfer to the treasury is rejected`, !inspectTransaction(noFee, t, owner).ok)
  // 2. underpay the fee by 1 lamport
  const under = retx(t.tx, (tx) => {
    tx.instructions = tx.instructions.map((ix) => {
      if (!isTransferTo(ix, treasury)) return ix
      const tr = SystemInstruction.decodeTransfer(ix)
      return SystemProgram.transfer({ fromPubkey: tr.fromPubkey, toPubkey: tr.toPubkey, lamports: Number(tr.lamports) - 1 })
    })
  })
  check(`${dest}: underpaying by 1 lamport is rejected`, !inspectTransaction(under, t, owner).ok)
  // 3. treasury pays someone (the drain)
  const target = new PublicKey(d.remainderTo ?? owner)
  const drain = retx(t.tx, (tx) => { tx.add(SystemProgram.transfer({ fromPubkey: treasury, toPubkey: target, lamports: Math.max(1, d.remainderLamports ?? 1000) })) })
  check(`${dest}: a transfer out of the treasury is rejected`, !inspectTransaction(drain, t, owner).ok)
  // 4. remainder taken out (other)
  if (dest === 'other') {
    const noRem = retx(t.tx, (tx) => { tx.instructions = tx.instructions.filter((ix) => !isTransferTo(ix, new PublicKey(other))) })
    check(`${dest}: dropping the remainder transfer is rejected`, !inspectTransaction(noRem, t, owner).ok)
  }
  // 4b. the drain: the remainder is paid by the treasury instead of the owner
  if (dest === 'other') {
    const swap = retx(t.tx, (tx) => {
      tx.instructions = tx.instructions.map((ix) => {
        if (!isTransferTo(ix, new PublicKey(other))) return ix
        const tr = SystemInstruction.decodeTransfer(ix)
        return SystemProgram.transfer({ fromPubkey: treasury, toPubkey: tr.toPubkey, lamports: Number(tr.lamports) })
      })
    })
    check(`${dest}: remainder paid out of the treasury is rejected`, !inspectTransaction(swap, t, owner).ok)
  }
  // 5. fee paid from someone else's account
  const fromElse = retx(t.tx, (tx) => {
    tx.instructions = tx.instructions.map((ix) => {
      if (!isTransferTo(ix, treasury)) return ix
      const tr = SystemInstruction.decodeTransfer(ix)
      return SystemProgram.transfer({ fromPubkey: new PublicKey(other), toPubkey: tr.toPubkey, lamports: Number(tr.lamports) })
    })
  })
  check(`${dest}: fee from a third party is rejected`, !inspectTransaction(fromElse, t, owner).ok)
}
// ---- fee payer and compute budget (treasury-paid transactions) ----
{
  const plan = await buildPlan({ address: owner, dest: 'same', burnDust: false, burnNft: false })
  const t = plan.txs[plan.txs.length - 1]
  const payer = (b64: string, who: PublicKey) => retx(b64, (tx) => { tx.feePayer = who })
  // owner-paid plan, signed with the treasury as payer
  check('fee payer swapped to the treasury is rejected', !inspectTransaction(payer(t.tx, treasury), t, owner).ok)
  // a treasury-paid plan (same tx with the treasury as planned payer)
  const tPlanned = { ...t, tx: payer(t.tx, treasury) }
  check('treasury-paid plan, unchanged, passes', inspectTransaction(tPlanned.tx, tPlanned, owner).ok)
  const bump = (kind: 'price' | 'limit') => retx(tPlanned.tx, (tx) => {
    tx.instructions = tx.instructions.map((ix) => {
      if (!ix.programId.equals(ComputeBudgetProgram.programId)) return ix
      const isPrice = ix.data[0] === 3
      if (kind === 'price' && isPrice) return ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000_000_000 })
      if (kind === 'limit' && !isPrice) return ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
      return ix
    })
  })
  check('treasury-paid: higher priority price is rejected', !inspectTransaction(bump('price'), tPlanned, owner).ok)
  check('treasury-paid: higher compute limit is rejected', !inspectTransaction(bump('limit'), tPlanned, owner).ok)
  const noLimit = retx(tPlanned.tx, (tx) => {
    tx.instructions = tx.instructions.filter((ix) => !(ix.programId.equals(ComputeBudgetProgram.programId) && ix.data[0] === 2))
  })
  check('treasury-paid: dropping the limit (default budget) is rejected', !inspectTransaction(noLimit, tPlanned, owner).ok)
  const lh = retx(t.tx, (tx) => {
    tx.add(new TransactionInstruction({ programId: new PublicKey('L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95'), keys: [{ pubkey: treasury, isSigner: true, isWritable: true }], data: Buffer.from([0]) }))
  })
  check('Lighthouse instruction signed by the treasury is rejected', !inspectTransaction(lh, t, owner).ok)
  const lhOk = retx(t.tx, (tx) => {
    tx.add(new TransactionInstruction({ programId: new PublicKey('L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95'), keys: [{ pubkey: new PublicKey(owner), isSigner: false, isWritable: false }], data: Buffer.from([0]) }))
  })
  check('wallet-added Lighthouse assertion still passes', inspectTransaction(lhOk, t, owner).ok)
}
console.log(results.join('\n'))
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0)
