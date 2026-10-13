<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Bucks from '../components/Bucks.vue'
import { bulkReportCsv, downloadCsv } from '../lib/bulk-run'
import { startBulkSign } from '../lib/bulk-sign'
import { fmt, lamportsToSol, short, solscanTx } from '../lib/mock'
import { TX_KEY, TX_LABEL, walletOutcome } from '../lib/run-status'
import { txState, watchSignatures } from '../lib/tx-status'
import { useStateStore } from '../stores'

const router = useRouter()
const flow = useStateStore()

// After a reload the poller is empty: pick the sent transactions up again.
onMounted(() => watchSignatures(flow.txs.filter((x) => x.ok).map((x) => x.sig)))

const bulk = computed(() => flow.mode === 'bulk')
const sentTxs = computed(() => flow.txs.filter((x) => x.ok))
const sum = (rows: typeof flow.txs) => lamportsToSol(rows.reduce((s, x) => s + (x.lamports ?? 0), 0))
const confirmedSol = computed(() => sum(sentTxs.value.filter((x) => txState(x.sig) === 'confirmed')))
const pendingSol = computed(() => sum(sentTxs.value.filter((x) => txState(x.sig) === 'pending')))
const failedTxs = computed(() => sentTxs.value.filter((x) => txState(x.sig) === 'failed').length)
const unknownTxs = computed(() => sentTxs.value.filter((x) => txState(x.sig) === 'unknown').length)
const singleRetry = computed(() => !bulk.value && Boolean(flow.err || failedTxs.value || unknownTxs.value))
const uncredited = computed(() => flow.dest === 'balance' && flow.partialPlan)

const counts = computed(() => {
  const c = { closed: 0, failed: 0, skipped: 0, clean: 0 }
  for (const r of flow.bulkReport) c[r.status]++
  return c
})

const where = computed(() => {
  if (flow.dest === 'balance') return 'to your Grabster balance (held by Grabster)'
  if (flow.dest === 'other' && flow.other) return `to ${short(flow.other)}`
  if (bulk.value) return 'back to each wallet'
  return `back to ${short(flow.addr)}`
})

/** Failed, skipped, or sent but not confirmed: a resumed run re-plans these from fresh chain data. */
function needsRetry(r: (typeof flow.bulkReport)[number]) {
  return r.status === 'failed' || r.status === 'skipped' || (r.status === 'closed' && walletOutcome(r).key === 'bad')
}
const retryable = computed(() => flow.bulkReport.filter(needsRetry).length)

function retryWallets() {
  flow.bulkReport = flow.bulkReport.filter((r) => !needsRetry(r))
  flow.screen = 'progress'
  startBulkSign({ resume: true }).catch((e: unknown) => {
    if (e instanceof Error && e.message === 'stopped') return
    flow.err = e instanceof Error ? e.message : 'The retry stopped.'
  })
}

function rescan() {
  flow.err = ''
  void flow.runScan()
}

function report() {
  downloadCsv('grabster-cleanup.csv', bulkReportCsv(flow.bulkReport))
}

function again() {
  flow.reset()
  void router.push(bulk.value ? '/cleanup?mode=list' : '/cleanup')
}
</script>

<template>
  <section class="screen">
    <header class="page-head">
      <!-- "SOL reclaimed" only once the network has confirmed it; until then it says what is still confirming. -->
      <p class="label" aria-live="polite">{{ pendingSol > 0 ? 'Confirming…' : confirmedSol > 0 ? 'SOL reclaimed' : 'Not confirmed' }}</p>
      <p class="big"><span class="num">{{ fmt(confirmedSol) }}</span><span class="unit">SOL<Bucks :sol="confirmedSol" paren /></span></p>
      <p class="lede" aria-live="polite">
        {{ where }}.
        <template v-if="pendingSol > 0"> <span class="num">{{ fmt(pendingSol) }}</span> SOL is still confirming.</template>
        <template v-if="failedTxs"> {{ failedTxs }} transaction{{ failedTxs === 1 ? '' : 's' }} failed on chain.</template>
        <template v-if="unknownTxs"> {{ unknownTxs }} {{ unknownTxs === 1 ? 'was' : 'were' }} not confirmed in time and may have been dropped — rescan to plan what’s left.</template>
      </p>

      <p v-if="uncredited" class="callout partial">
        Part of a plan landed before it stopped. That part is credited to your Grabster balance as its own entry once its
        transactions confirm — see Profile → Activity.
      </p>

      <p v-if="flow.err && !bulk" class="callout partial" role="alert">
        Not everything went through: {{ flow.err }} The transactions below already landed.
        Rescan to plan only what’s left.
      </p>

      <div class="actions">
        <button v-if="singleRetry" class="btn arrow" type="button" @click="rescan">Rescan and retry</button>
        <button v-if="bulk && retryable" class="btn arrow" type="button" @click="retryWallets">Retry {{ retryable }} wallet{{ retryable === 1 ? '' : 's' }}</button>
        <button v-if="flow.dest === 'balance'" class="btn btn-ghost arrow" type="button" @click="router.push('/profile/balance')">Open Grabster balance</button>
        <button v-if="bulk && flow.bulkReport.length" class="btn btn-ghost" type="button" @click="report">Download report</button>
        <button class="btn btn-ghost arrow" type="button" @click="again">{{ bulk ? 'New list' : 'Check another wallet' }}</button>
      </div>
    </header>

    <section v-if="bulk && flow.bulkReport.length" class="page-section">
      <p class="kicker"><span>01</span>Wallets</p>
      <div class="stats-row">
        <div><b>{{ counts.closed }}</b><small>Sent</small></div>
        <div><b>{{ counts.failed }}</b><small>Failed</small></div>
        <div><b>{{ counts.skipped }}</b><small>Skipped</small></div>
        <div><b>{{ counts.clean }}</b><small>Nothing to close</small></div>
      </div>
      <div class="tscroll">
        <table class="table">
          <thead><tr><th scope="col">Wallet</th><th scope="col" class="num">Accounts</th><th scope="col" class="num">Sent to recipient</th><th scope="col">Status</th></tr></thead>
          <tbody>
            <tr v-for="r in flow.bulkReport" :key="r.addr">
              <td class="mono" :title="r.addr">{{ short(r.addr) }}</td>
              <td class="num">{{ r.boxes || '—' }}</td>
              <td class="num">{{ r.sol ? `${fmt(r.sol, 6)} SOL` : '—' }}</td>
              <td>
                <span class="status" :data-s="walletOutcome(r).key">{{ walletOutcome(r).label }}</span>
                <small v-if="r.note && r.status !== 'clean' && r.status !== 'closed'" class="row-note">{{ r.note }}</small>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="sentTxs.length" class="page-section">
      <p class="kicker"><span>{{ bulk ? '02' : '01' }}</span>Transactions</p>
      <div class="tscroll">
        <table class="table">
          <thead><tr><th scope="col">#</th><th v-if="bulk" scope="col">Wallet</th><th scope="col" class="num">Accounts</th><th scope="col" class="num">SOL</th><th scope="col">Status</th><th scope="col">Signature</th></tr></thead>
          <tbody>
            <tr v-for="(x, i) in sentTxs" :key="x.sig">
              <td class="num">{{ i + 1 }}</td>
              <td v-if="bulk" class="mono">{{ x.wallet ? short(x.wallet) : '—' }}</td>
              <td class="num">{{ x.boxes }}</td>
              <td class="num">{{ x.lamports != null ? fmt(lamportsToSol(x.lamports), 6) : '—' }}</td>
              <td><span class="status" :data-s="TX_KEY[txState(x.sig)]">{{ TX_LABEL[txState(x.sig)] }}</span></td>
              <td class="mono sig"><a :href="solscanTx(x.sig)" target="_blank" rel="noopener noreferrer">{{ short(x.sig) }} ↗</a></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>

<style scoped lang="scss">
.page-head > .label { margin-top: 8px; font-size: 16px; }

/* The confirmed amount: the one big purple figure on the page. */
.big {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 18px;
  margin: 10px 0 24px;

  .num {
    font-family: var(--display);
    font-weight: 600;
    font-size: clamp(72px, 12vw, 192px);
    line-height: 0.85;
    letter-spacing: -0.05em;
    color: var(--accent-text);
    overflow-wrap: anywhere;
  }

  .unit {
    font-size: clamp(22px, 2.4vw, 34px);
    font-weight: 500;
    letter-spacing: -0.02em;
    color: var(--ink);
    white-space: nowrap;

    :deep(.bucks) { font-size: 16px; letter-spacing: 0; }
  }
}

.partial { margin-top: 24px; max-width: 72ch; }

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 36px;

  .btn { min-height: 52px; }

  @media (max-width: 560px) {
    flex-direction: column;
  }
}

.stats-row { margin-bottom: 32px; }

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

.row-note {
  display: block;
  margin-top: 4px;
  color: var(--muted);
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
