import { Keypair } from '@solana/web3.js'
import { buildLocalPlan, explainLocalPlan, inspectPlan, type TokenBox } from '../src/index.ts'

function box(partial: Pick<TokenBox, 'kind' | 'amount' | 'lamports'> & Partial<TokenBox>): TokenBox {
  return {
    address: Keypair.generate().publicKey.toBase58(),
    mint: Keypair.generate().publicKey.toBase58(),
    program: 'token',
    decimals: 6,
    extraLamports: 0,
    space: 165,
    excessLamports: 0,
    frozen: false,
    native: false,
    delegate: '',
    extensions: [],
    symbol: '',
    logo: '',
    usdPrice: 0,
    valueUsd: 0,
    liquidityUsd: 0,
    hasPrice: false,
    listed: false,
    netValueUsd: 0,
    transferFeeBps: 0,
    sweepable: false,
    collection: '',
    collectionVerified: false,
    nftBurnable: false,
    tokenStandard: null,
    ruleSet: '',
    ...partial,
  }
}

const owner = Keypair.generate().publicKey.toBase58()
const blockhash = Keypair.generate().publicKey.toBase58()
const empties = Array.from({ length: 30 }, () => box({ kind: 'empty', amount: '0', lamports: 2_039_280 }))
const dust = box({ kind: 'dust', amount: '10', lamports: 2_039_280 })
const refund = box({ kind: 'keep', amount: '100', lamports: 2_089_280, excessLamports: 50_000 })
const boxes = [...empties, dust, refund]

const treasury = 'za6UNCCaM8gnJNPW1nMBcipyehzaxvu3LocYX22N8hD'
const plan = buildLocalPlan({
  address: owner,
  boxes,
  solLamports: 50_000_000,
  systemRentLamports: 890_880,
  blockhash,
  priorityMicroLamports: 1_000,
  burnAccounts: [dust.address],
  refundExcess: true,
  refundAccounts: [refund.address],
  feePercent: 10,
  treasury,
})

const checked = inspectPlan(plan.txs, owner)
if (!checked.ok) throw new Error(checked.reason)
const expectedFee = Math.floor(plan.recoveredLamports * 10 / 100)
if (plan.feeLamports !== expectedFee || plan.netLamports !== plan.recoveredLamports - expectedFee) {
  throw new Error(`Fee should be 10% (${expectedFee}), got ${plan.feeLamports}.`)
}
if (plan.needsTreasurySig || plan.feePayer !== owner) {
  throw new Error('Local plan must be paid by the owner.')
}
if (plan.txs.some((tx) => tx.description.feeLamports <= 0 || tx.description.feeTo !== treasury)) {
  throw new Error('Every local transaction must pay the Grabster treasury.')
}
if (plan.txs.filter((tx) => tx.type === 'CLOSE').length !== 2) {
  throw new Error(`Expected 2 close transactions, got ${plan.txs.filter((tx) => tx.type === 'CLOSE').length}.`)
}
if (!plan.txs.some((tx) => tx.type === 'BURN') || !plan.txs.some((tx) => tx.type === 'REFUND')) {
  throw new Error('Burn and refund transactions missing.')
}
if (!explainLocalPlan(plan).some((line) => line.startsWith('Grabster fee:') && !line.endsWith('0 SOL'))) {
  throw new Error('Review text omitted the Grabster fee.')
}

let refused = false
try {
  buildLocalPlan({
    address: owner,
    boxes: [],
    solLamports: 50_000_000,
    systemRentLamports: 890_880,
    blockhash,
    priorityMicroLamports: 1_000,
  })
} catch (err) {
  refused = err instanceof Error && err.message === 'Nothing to grab.'
}
if (!refused) throw new Error('Empty wallet should refuse.')

console.log(`local plan ok: ${plan.txs.length} txs, ${plan.recoveredLamports} lamports, fee ${plan.feeLamports}`)
