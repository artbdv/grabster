<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { bulkHasWork, fulfillBulkAdvance, fulfillBulkConnect, skipBulkConnect } from '../lib/bulk-run'
import { fmt, lamportsToSol, short, solscanTx } from '../lib/mock'
import { TX_KEY, TX_LABEL, walletOutcome, type StatusKey } from '../lib/run-status'
import { secretFor } from '../lib/secrets'
import { txState, watchSignatures } from '../lib/tx-status'
import { wallet } from '../lib/wallet'
import { useStateStore, useWalletStore } from '../stores'

const flow = useStateStore()

// After a reload the poller is empty: pick the sent transactions up again.
onMounted(() => watchSignatures(flow.txs.filter((x) => x.ok).map((x) => x.sig)))
const wallets = useWalletStore()

const bulk = computed(() => flow.mode === 'bulk')
/** Rows replaced by a rebuilt plan were never sent; they drop out of the count. */
const rows = computed(() => flow.txs.filter((x) => !x.dropped))
const total = computed(() => rows.value.length)
const sent = computed(() => rows.value.filter((x) => x.ok).length)
const confirmed = computed(() => rows.value.filter((x) => x.ok && txState(x.sig) === 'confirmed').length)
const queue = computed(() => flow.bulkPhase === 'need-connect' || flow.bulkPhase === 'need-switch')
const step = computed(() => flow.bulkQueueTotal ? `${flow.bulkQueueIndex + 1} of ${flow.bulkQueueTotal}` : '')
const otherInList = computed(() =>
  Boolean(wallet.publicKey && flow.bulkAccept.includes(wallet.publicKey) && wallet.publicKey !== flow.bulkExpect),
)

/** One row per wallet that has work, with where it stands right now. */
const walletRows = computed(() => {
  const byAddr = new Map(flow.bulkReport.map((r) => [r.addr, r]))
  return flow.bulkRows
    .filter((r) => bulkHasWork(r, flow.bulkExcess))
    .map((r) => {
      const done = byAddr.get(r.addr)
      let key: StatusKey = 'none'
      let label = 'Waiting'
      if (done) ({ key, label } = walletOutcome(done))
      else if (r.addr === flow.bulkExpect && flow.bulkPhase === 'need-connect') { key = 'wait'; label = 'Needs signature' }
      else if (r.addr === flow.bulkExpect && flow.bulkPhase === 'signing') { key = 'wait'; label = 'Signing' }
      else if (secretFor(r.addr)) { key = 'wait'; label = 'Signing in this tab' }
      return { addr: r.addr, empty: r.empty, key, label, note: done?.note || '', sol: done?.sol ?? 0 }
    })
})

const waitingWallets = computed(() => walletRows.value.filter((w) => w.label === 'Waiting' || w.label === 'Needs signature').length)

/** Single wallet: say what the run is waiting for right now. */
const phaseTitle = computed(() => {
  if (flow.runPhase === 'approve') return 'Approve in your wallet…'
  if (flow.runPhase === 'confirming') return 'Confirming…'
  if (flow.runPhase === 'preparing') return 'Preparing…'
  return total.value && confirmed.value < total.value ? 'Confirming…' : 'Signing and sending.'
})

function connect() { wallets.open('bulk', flow.bulkExpect) }
function next() { fulfillBulkAdvance() }
function skip() { skipBulkConnect() }
function takeConnected() { fulfillBulkConnect() }
</script>

<template>
  <section class="screen">
    <header class="page-head">
      <h1>{{ bulk ? 'Signing and sending.' : phaseTitle }}</h1>
      <p class="lede" aria-live="polite">
        <template v-if="total"><span class="num">{{ sent }}</span> of <span class="num">{{ total }}</span> transactions sent · <span class="num">{{ confirmed }}</span> confirmed.</template>
        <template v-else-if="queue">Wallet {{ step }} — waiting for its signature.</template>
        <template v-else>Preparing the first plan…</template>
        <template v-if="bulk && waitingWallets"> {{ waitingWallets }} wallet{{ waitingWallets === 1 ? '' : 's' }} still need to sign.</template>
      </p>
      <div v-if="total" class="bar" role="progressbar" :aria-valuenow="sent" :aria-valuemax="total" aria-label="Transactions sent">
        <i :style="{ width: (sent / total) * 100 + '%' }"></i>
      </div>
    </header>

    <section v-if="queue" class="queue" aria-live="polite">
      <p class="label">Wallet {{ step }}</p>
      <p class="queue-addr mono">{{ flow.bulkExpect }}</p>
      <p v-if="flow.bulkPhase === 'need-switch'" class="queue-copy">
        Open {{ wallet.name || 'your wallet' }} and switch to the account above. Then press Next — we disconnect and ask you to connect that account.
      </p>
      <template v-else>
        <p class="queue-copy">
          In Phantom or Solflare, open the account switcher and pick the address above. Then press Connect wallet and approve.
        </p>
        <p v-if="otherInList" class="queue-copy">
          You’re connected as <span class="mono">{{ short(wallet.publicKey) }}</span>, which is also in this list. You can close it first.
        </p>
      </template>
      <p v-if="flow.bulkMismatch" class="err">{{ flow.bulkMismatch }}</p>
      <div class="queue-actions">
        <button v-if="flow.bulkPhase === 'need-switch'" class="btn arrow" type="button" @click="next">Next</button>
        <button v-else-if="otherInList" class="btn arrow" type="button" @click="takeConnected">Close this one first</button>
        <button v-else class="btn arrow" type="button" @click="connect">Connect wallet</button>
        <button v-if="flow.bulkPhase === 'need-connect'" class="btn btn-ghost" type="button" @click="skip">Skip this wallet</button>
        <button class="link" type="button" @click="flow.cancelFlow()">Cancel cleanup</button>
      </div>
    </section>
    <p v-else-if="bulk" class="cancel"><button class="link" type="button" @click="flow.cancelFlow()">Cancel cleanup</button></p>

    <section v-if="bulk && walletRows.length" class="page-section">
      <p class="kicker"><span>01</span>Wallets</p>
      <div class="tscroll">
        <table class="table">
          <thead><tr><th scope="col">Wallet</th><th scope="col" class="num">Empty accounts</th><th scope="col">Status</th><th scope="col" class="num">Sent to recipient</th></tr></thead>
          <tbody>
            <tr v-for="w in walletRows" :key="w.addr">
              <td class="mono" :title="w.addr">{{ short(w.addr) }}</td>
              <td class="num">{{ w.empty }}</td>
              <td><span class="status" :data-s="w.key">{{ w.label }}</span><small v-if="w.note && w.key === 'bad'" class="row-note">{{ w.note }}</small></td>
              <td class="num">{{ w.sol ? `${fmt(w.sol, 6)} SOL` : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="rows.length" class="page-section">
      <p class="kicker"><span>{{ bulk ? '02' : '01' }}</span>Transactions</p>
      <div class="tscroll">
        <table class="table">
          <thead><tr><th scope="col">#</th><th scope="col" v-if="bulk">Wallet</th><th scope="col" class="num">Accounts</th><th scope="col" class="num">SOL</th><th scope="col">Status</th><th scope="col">Signature</th></tr></thead>
          <tbody>
            <tr v-for="(x, i) in rows" :key="i + x.sig">
              <td class="num">{{ i + 1 }}</td>
              <td v-if="bulk" class="mono">{{ x.wallet ? short(x.wallet) : '—' }}</td>
              <td class="num">{{ x.boxes }}</td>
              <td class="num">{{ x.lamports != null ? fmt(lamportsToSol(x.lamports), 6) : '—' }}</td>
              <td>
                <span v-if="!x.ok" class="status" data-s="none">Not sent</span>
                <span v-else class="status" :data-s="TX_KEY[txState(x.sig)]">{{ TX_LABEL[txState(x.sig)] }}</span>
              </td>
              <td class="mono sig">
                <a v-if="x.ok && x.sig && x.sig !== '…'" :href="solscanTx(x.sig)" target="_blank" rel="noopener noreferrer">{{ short(x.sig) }} ↗</a>
                <span v-else>—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>

<style scoped lang="scss">
/* Progress: a thick track on the page rule, the sent share in purple. */
.bar {
  height: 8px;
  max-width: 960px;
  margin-top: 32px;
  background: var(--bg-2);
  border: 1px solid var(--line-3);
  overflow: hidden;

  i {
    display: block;
    height: 100%;
    background: var(--accent);
    width: 0;
    transition: width 0.35s ease;
  }
}

/* The wallet waiting for a signature: its own band, a large address and the actions. */
.queue {
  padding: 40px var(--gutter) 48px;
  border-bottom: 1px solid var(--line-2);
  background: var(--surface);

  .label { font-size: 16px; }
}

.queue-addr {
  margin: 14px 0 0;
  font-size: clamp(17px, 2vw, 26px);
  color: var(--ink);
  overflow-wrap: anywhere;
}

.queue-copy {
  margin: 14px 0 0;
  font-size: 16px;
  color: var(--ink-2);
  max-width: 70ch;
}

.queue-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 20px;
  margin-top: 28px;

  .btn { min-height: 52px; }
}

/* Table rows run edge to edge on their rules; the first and last cell keep the gutter. */
.page-section > .tscroll {
  margin: 0 calc(-1 * var(--gutter));
  max-width: none;

  .table {
    th:first-child,
    td:first-child { padding-left: var(--gutter); }

    th:last-child,
    td:last-child { padding-right: var(--gutter); }
  }
}

.cancel {
  padding: 20px var(--gutter);
  border-bottom: 1px solid var(--line-2);
}

.row-note {
  display: block;
  margin-top: 4px;
  color: var(--bad);
  font-size: 13px;
}

.sig a {
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--line-3);
  text-underline-offset: 3px;

  &:hover { color: var(--accent-text); text-decoration-color: var(--accent); }
}
</style>
