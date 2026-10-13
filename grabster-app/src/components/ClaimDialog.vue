<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { lamportsToSol, networkFeeSol, short, treasuryGasWithholdSol, withBucks, fmt } from '../lib/mock'
import type { PlanResponse, PlannedTx } from '@grabster/solana-core'
import { fetchBalance, fetchPlan, fetchSubmit, isRebuildableError, signaturesOf } from '../lib/api'
import { storedRef } from '../lib/ref'
import { startBulkSign } from '../lib/bulk-sign'
import { pendingFrom } from '../lib/bulk-run'
import { LIST_ROUTE, replace } from '../lib/nav'
import { secretFor } from '../lib/secrets'
import { signWithAdapter, signWithSecret } from '../lib/sign'
import { signAllWallet, wallet } from '../lib/wallet'
import { useAuthStore, useStateStore, useUiStore, useWalletStore } from '../stores'

const flow = useStateStore()
const ui = useUiStore()
const wallets = useWalletStore()
const auth = useAuthStore()

const err = ref('')
const working = ref(false)
const preview = ref<PlanResponse | null>(null)
const previewing = ref(false)
const previewErr = ref('')

const bulk = computed(() => flow.mode === 'bulk')
const hasSecret = computed(() => Boolean(secretFor(flow.addr)) || flow.kind === 'key' || flow.kind === 'seed')
const ready = computed(() => {
  if (bulk.value) return true
  if (hasSecret.value) return true
  return wallet.publicKey === flow.addr
})
const signedAs = computed(() => wallet.publicKey || wallets.signer || flow.addr)
const hasWork = computed(() => flow.tot.boxes > 0 || flow.refundAccounts.length > 0 || (bulk.value && flow.tot.net > 0))
const canSign = computed(() => {
  if (working.value || previewing.value) return false
  if (bulk.value) return hasWork.value
  return ready.value && Boolean(preview.value)
})

/* ---------- exact numbers from the plan (single wallet) ---------- */

const plan = computed(() => {
  const p = preview.value
  if (!p) return null
  const pct = p.dest === 'balance' ? flow.cfg.feeBalance : flow.cfg.feeDirect
  let closes = 0, burns = 0, nfts = 0, refunds = 0, sweeps = 0, txCredit = 0, remainder = 0, grabsterFee = 0
  for (const t of p.txs) {
    const d = t.description
    closes += d.closes - d.burns - d.sweeps
    burns += d.burns
    sweeps += d.sweeps
    nfts += d.nfts || 0
    refunds += d.refunds || 0
    txCredit += d.creditLamports ?? 0
    remainder += d.remainderLamports ?? 0
    grabsterFee += d.serviceFeeLamports ?? Math.min(d.feeLamports, Math.floor((d.recoveredLamports * pct) / 100))
  }
  const treasuryPays = p.feePayer !== p.address
  const withheldGas = treasuryPays ? Math.max(0, p.feeLamports - grabsterFee) : 0
  // To the balance, leftover credit is part of netLamports rather than a per-transaction transfer.
  const credit = p.dest === 'balance' ? Math.max(0, p.netLamports - remainder) : txCredit
  // With another address or the balance as recipient, the server leaves the wallet its rent-exempt minimum.
  const kept = p.dest === 'same' ? 0 : Math.max(0, p.recoveredLamports - p.feeLamports - remainder)
  return {
    pct,
    closes, burns, nfts, refunds, sweeps,
    gross: lamportsToSol(p.recoveredLamports),
    fee: lamportsToSol(grabsterFee),
    withheldGas: lamportsToSol(withheldGas),
    walletGas: treasuryPays ? 0 : flow.cfg.gas * p.txs.length,
    credit: lamportsToSol(credit),
    kept: lamportsToSol(kept),
    net: lamportsToSol(p.netLamports),
    treasuryPays,
    txs: p.txs.length,
  }
})

const recipient = computed(() => {
  if (flow.dest === 'balance') return `Grabster balance of ${short(auth.address)} — held by Grabster`
  if (bulk.value && flow.dest === 'same') return 'Each wallet keeps its own SOL'
  if (flow.dest === 'other' && flow.other) return short(flow.other)
  return short(flow.addr)
})

function txLine(row: PlannedTx): string {
  const d = row.description
  const parts: string[] = []
  const plainCloses = d.closes - d.burns - d.sweeps
  if (plainCloses > 0) parts.push(`close ${plainCloses} empty account${plainCloses === 1 ? '' : 's'}`)
  if (d.burns) parts.push(`burn ${d.burns} leftover${d.burns === 1 ? '' : 's'} and close`)
  if (d.sweeps) parts.push(`give ${d.sweeps} leftover${d.sweeps === 1 ? '' : 's'} to Grabster and close`)
  if (d.nfts) parts.push(`burn ${d.nfts} NFT${d.nfts === 1 ? '' : 's'}`)
  if (d.refunds) parts.push(`withdraw extra rent from ${d.refunds}`)
  return parts.join(', ')
}

/* ---------- bulk estimate ---------- */

const bulkGas = computed(() => {
  let walletGas = 0
  let withheld = 0
  for (const r of flow.bulkRows) {
    if (!(r.empty > 0 || (flow.bulkExcess && r.excess > 0))) continue
    const split = { emptyBoxes: r.empty, dustBoxes: 0, nftBoxes: 0, refundBoxes: flow.bulkExcess ? r.excess : 0, sweep: false }
    if (flow.cfg.treasuryPaysGas && r.noSol) withheld += treasuryGasWithholdSol(r.empty, flow.cfg, true, split)
    else walletGas += networkFeeSol(r.empty, flow.dest, flow.cfg, split)
  }
  return { walletGas, withheld }
})

/* ---------- signing (unchanged rules) ---------- */

async function loadPreview() {
  if (bulk.value || !flow.addr || !hasWork.value) return
  previewing.value = true
  previewErr.value = ''
  preview.value = null
  try {
    preview.value = await fetchPlan(planBody(flow.addr))
  } catch (e) {
    previewErr.value = e instanceof Error ? e.message : 'Could not build the transactions.'
  } finally {
    previewing.value = false
  }
}

async function assertGas(address: string, boxes: number) {
  if (flow.cfg.treasuryPaysGas) return
  const need = networkFeeSol(boxes, flow.dest, flow.cfg, flow.feeSplit)
  const { sol } = await fetchBalance(address)
  if (sol + 1e-9 < need) {
    throw new Error(`This wallet needs ~${withBucks(need, flow.solUsd, 4)} for network fees. It only has ${withBucks(sol, flow.solUsd, 4)}.`)
  }
}

function planBody(address: string) {
  const burnAccounts = flow.burnAccounts
  const sweepAccounts = flow.sweepAccounts
  return {
    address,
    dest: flow.dest,
    other: flow.dest === 'other' ? flow.other : undefined,
    burnDust: burnAccounts.length > 0,
    burnAccounts,
    sweepAccounts,
    burnNft: flow.nftAccounts.length > 0,
    nftAccounts: flow.nftAccounts,
    refundExcess: flow.refundAccounts.length > 0,
    refundAccounts: flow.refundAccounts,
  }
}

async function execute(p: PlanResponse, address: string, start: number) {
  const secret = secretFor(address)
  const adapterOk = wallet.publicKey === address
  let signed: string[]
  flow.runPhase = 'approve'
  if (secret) signed = signWithSecret(p, secret)
  else if (adapterOk) signed = await signWithAdapter(p, address, signAllWallet)
  else throw new Error('Connect the wallet or use its key to sign.')

  flow.runPhase = 'confirming'
  const { signatures } = await fetchSubmit(p.planId, signed, storedRef(), flow.mode === 'bulk' ? 'batch' : 'web')
  flow.markTxs(start, signatures)
}

/** Keep the transactions that landed before an error; drop the rest so a retry plans only what’s left. */
function keepPartial(e: unknown, start: number) {
  const landed = signaturesOf(e)
  if (landed.length) flow.partialPlan = true
  flow.markTxs(start, landed)
  flow.txs = flow.txs.slice(0, start + landed.length)
  flow.total = flow.txs.length
}

async function runAddress(address: string, initial?: PlanResponse) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const p = attempt === 0 && initial ? initial : await fetchPlan(planBody(address))
    if (!p.txs.length) {
      if (attempt === 0 && !flow.txs.some((t) => t.ok)) throw new Error('Nothing to close.')
      return
    }
    const reuseFirst = attempt === 0 && initial && flow.txs.length === p.txs.length
    if (!reuseFirst) flow.markProgress([...flow.txs, ...pendingFrom(p, address)])
    const start = flow.txs.length - p.txs.length
    try {
      await execute(p, address, start)
      return
    } catch (e) {
      keepPartial(e, start)
      if (!isRebuildableError(e) || attempt === 2) throw e
    }
  }
}

async function ensureLogin() {
  if (auth.address) return
  if (flow.dest !== 'balance') {
    if (!bulk.value && hasSecret.value) return
    if (bulk.value && flow.bulkRows.every((r) => secretFor(r.addr))) return
  }
  if (!wallet.publicKey) {
    wallets.open(flow.dest === 'balance' ? 'claim-login' : 'login')
    throw new Error('login')
  }
  await auth.loginWithConnectedWallet()
}

async function sign() {
  err.value = ''
  if (!bulk.value && !ready.value) return
  try {
    await ensureLogin()
  } catch (e) {
    if (e instanceof Error && e.message === 'login') return
    err.value = e instanceof Error ? e.message : 'Could not sign in.'
    ui.showToast(err.value)
    return
  }
  working.value = true
  try {
    if (bulk.value) {
      await startBulkSign()
      return
    }
    flow.runPhase = 'preparing'
    flow.err = ''
    await assertGas(flow.addr, flow.tot.boxes)
    const first = preview.value && preview.value.address === flow.addr
      ? preview.value
      : await fetchPlan(planBody(flow.addr))
    ui.closeClaim()
    flow.goProgress(first.txs.length)
    flow.markProgress(pendingFrom(first, flow.addr))

    await runAddress(flow.addr, first)
    if (!flow.txs.length) throw new Error('Nothing to close.')
    flow.finishOk()
  } catch (e) {
    const stopped = e instanceof Error && e.message === 'stopped'
    if (stopped) {
      flow.resetBulkQueue()
      if (bulk.value) flow.screen = 'hero'
      return
    }
    err.value = e instanceof Error ? e.message : 'The transaction did not match the plan. Signing was blocked.'
    ui.showToast(err.value)
    if (flow.screen === 'progress') {
      const landed = flow.txs.some((t) => t.ok)
      if (!bulk.value && landed) {
        // Part of the plan is on chain: show what landed; the retry rescans so it plans only what's left.
        flow.err = err.value
        flow.finishOk()
        return
      }
      flow.screen = bulk.value ? 'hero' : 'result'
      ui.claimOpen = true
      if (bulk.value) void replace(LIST_ROUTE)
    }
  } finally {
    working.value = false
    flow.runPhase = ''
  }
}

const signLabel = computed(() => {
  if (bulk.value) return 'Start'
  if (flow.runPhase === 'preparing') return 'Preparing…'
  if (flow.runPhase === 'approve') return 'Approve in your wallet…'
  if (flow.runPhase === 'confirming') return 'Confirming…'
  return working.value ? 'Preparing…' : 'Reclaim SOL'
})

function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') ui.closeClaim() }

onMounted(() => {
  document.addEventListener('keydown', onEsc)
  void loadPreview()
})
onUnmounted(() => document.removeEventListener('keydown', onEsc))
</script>

<template>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="claimTitle" @click.self="ui.closeClaim">
    <div class="card">
      <p class="eyebrow">{{ bulk ? 'Wallet list' : 'Single wallet' }}</p>
      <h2 id="claimTitle">{{ bulk ? 'Start the cleanup' : 'Reclaim review' }}</h2>

      <!-- single wallet: exact plan -->
      <template v-if="!bulk">
        <p class="muted">
          Signing as <span class="mono">{{ short(signedAs) }}</span>
          <template v-if="hasSecret"> with the key in this tab.</template>
          <template v-else-if="wallet.name"> in {{ wallet.name }}.</template>
        </p>
        <p v-if="previewing" class="muted wait" aria-live="polite"><span class="status" data-s="wait">Building the exact plan</span></p>

        <template v-if="plan && preview">
          <dl class="kv">
            <div>
              <dt>Action</dt>
              <dd class="text">
                <template v-if="plan.closes">Close {{ plan.closes }} empty account{{ plan.closes === 1 ? '' : 's' }}</template>
                <template v-if="plan.burns"><br>Burn {{ plan.burns }} leftover{{ plan.burns === 1 ? '' : 's' }} and close</template>
                <template v-if="plan.sweeps"><br>Give {{ plan.sweeps }} leftover{{ plan.sweeps === 1 ? '' : 's' }} to Grabster and close</template>
                <template v-if="plan.nfts"><br>Burn {{ plan.nfts }} NFT{{ plan.nfts === 1 ? '' : 's' }}</template>
                <template v-if="plan.refunds"><br>Withdraw extra rent from {{ plan.refunds }}</template>
              </dd>
            </div>
            <div><dt>Recipient</dt><dd class="text">{{ recipient }}</dd></div>
            <div><dt>Gross recovery</dt><dd>{{ fmt(plan.gross, 6) }} SOL</dd></div>
            <div><dt>Grabster fee · {{ plan.pct }}%</dt><dd>−{{ fmt(plan.fee, 6) }} SOL</dd></div>
            <div v-if="plan.credit"><dt>Leftover credit</dt><dd>+{{ fmt(plan.credit, 6) }} SOL</dd></div>
            <div v-if="plan.treasuryPays"><dt>Network fee · paid by Grabster, withheld</dt><dd>−{{ fmt(plan.withheldGas, 6) }} SOL</dd></div>
            <div v-else><dt>Network fee · paid by this wallet</dt><dd>~{{ fmt(plan.walletGas, 6) }} SOL</dd></div>
            <div v-if="plan.kept > 0"><dt>Stays in this wallet · rent-exempt minimum</dt><dd>−{{ fmt(plan.kept, 6) }} SOL</dd></div>
            <div><dt>Network fee payer</dt><dd>{{ short(preview.feePayer) }} · {{ plan.treasuryPays ? 'Grabster' : 'this wallet' }}</dd></div>
            <div class="total"><dt>Net to recipient</dt><dd>{{ fmt(plan.net, 6) }} SOL</dd></div>
          </dl>
          <p v-if="!plan.treasuryPays" class="hint">The network fee comes from this wallet’s SOL; it is not taken from the payout.</p>

          <details class="txs">
            <summary>{{ plan.txs }} transaction{{ plan.txs === 1 ? '' : 's' }} · {{ hasSecret ? 'signed in this tab' : plan.txs === 1 ? 'your wallet asks once' : `your wallet asks ${plan.txs} times` }}</summary>
            <ol>
              <li v-for="row in preview.txs" :key="row.id">
                <span>{{ txLine(row) }}</span>
                <span class="num">{{ fmt(lamportsToSol(row.description.recoveredLamports), 6) }} SOL</span>
              </li>
            </ol>
          </details>
          <p class="hint">The plan is valid for about {{ flow.cfg.limits?.planTtlSec ?? 90 }} seconds. The server checks every signed transaction against it.</p>
        </template>
      </template>

      <!-- wallet list: estimate + how signing works -->
      <template v-else>
        <dl class="kv">
          <div><dt>Wallets</dt><dd>{{ flow.bulkRows.filter((r) => r.empty > 0 || (flow.bulkExcess && r.excess > 0)).length }}</dd></div>
          <div><dt>Accounts to close</dt><dd>{{ flow.tot.boxes }}</dd></div>
          <div><dt>Recipient</dt><dd class="text">{{ recipient }}</dd></div>
          <div><dt>Gross recovery · estimate</dt><dd>{{ fmt(flow.tot.gross, 6) }} SOL</dd></div>
          <div><dt>Grabster fee · {{ flow.tot.fee }}%</dt><dd>−{{ fmt(flow.tot.feeSol, 6) }} SOL</dd></div>
          <div v-if="bulkGas.withheld"><dt>Network fee · paid by Grabster, withheld</dt><dd>−{{ fmt(bulkGas.withheld, 6) }} SOL</dd></div>
          <div v-if="bulkGas.walletGas"><dt>Network fee · paid by each wallet</dt><dd>~{{ fmt(bulkGas.walletGas, 6) }} SOL</dd></div>
          <div class="total"><dt>Estimated net</dt><dd>{{ fmt(flow.tot.net, 6) }} SOL</dd></div>
        </dl>
        <ol class="steps-list how">
          <li><b>Keys in this tab sign first</b><p>Wallets you imported keys for are planned, signed and sent without prompts.</p></li>
          <li><b>Then one wallet at a time</b><p>We show the next address. In Phantom or Solflare, switch to that account, connect, and approve.</p></li>
          <li><b>Every wallet gets its own plan</b><p>Built from fresh chain data right before it signs, with exact amounts and the fee inside.</p></li>
        </ol>
      </template>

      <p v-if="err || previewErr" class="err" role="alert">{{ err || previewErr }}</p>

      <div class="modal-actions">
        <button class="btn btn-ghost" type="button" @click="ui.closeClaim">Back</button>
        <button class="btn arrow" type="button" :disabled="!canSign" @click="sign">
          {{ signLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.wait { margin-top: 18px; }

.card > .muted { font-size: 15px; }

.kv {
  margin-top: 24px;

  dd.text {
    font-family: var(--body);
    text-align: right;
    line-height: 1.5;
  }
}

/* Transaction list: a disclosure on rules with the +/− in its own cell. */
.txs {
  margin-top: 20px;
  border: 1px solid var(--line-3);

  summary {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 48px;
    align-items: stretch;
    min-height: 48px;
    cursor: pointer;
    list-style: none;
    font-size: 15px;
    color: var(--ink);

    &::-webkit-details-marker { display: none; }

    &::before { content: none; }

    &::after {
      content: '+';
      display: grid;
      place-items: center;
      border-left: 1px solid var(--line-3);
      font-family: var(--mono);
      font-size: 18px;
    }

    &:hover { background: var(--surface); }
    &:focus-visible { outline-offset: -3px; }
  }

  summary {
    padding-left: 16px;
    align-items: center;

    &::after { align-self: stretch; }
  }

  &[open] summary {
    border-bottom: 1px solid var(--line-3);

    &::after { content: '−'; background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
  }

  ol {
    margin: 0;
    padding: 0;
    list-style: none;
    counter-reset: tx;
    font-size: 14px;
    color: var(--ink-2);
    background: var(--surface);

    li {
      counter-increment: tx;
      display: grid;
      grid-template-columns: 32px minmax(0, 1fr) auto;
      gap: 12px;
      padding: 10px 16px;
      border-top: 1px solid var(--line-2);

      &:first-child { border-top: 0; }

      &::before {
        content: counter(tx, decimal-leading-zero);
        font-family: var(--mono);
        font-size: 12px;
        color: var(--muted);
        padding-top: 2px;
      }
    }

    li span.num { color: var(--ink); white-space: nowrap; }
  }
}

.how { margin-top: 24px; }
</style>
