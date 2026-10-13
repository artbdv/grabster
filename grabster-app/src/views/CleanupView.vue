<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Bucks from '../components/Bucks.vue'
import DestinationChoices from '../components/DestinationChoices.vue'
import { clampRange, parseBulkText, textHasSeed } from '../lib/bulk-input'
import { bulkHasWork, downloadCsv } from '../lib/bulk-run'
import { checkAddressList } from '../lib/list-input'
import { bulkTotals, fmt, networkFeeSol, short, treasuryGasWithholdSol } from '../lib/mock'
import { forgetSecret, rememberSecret, secretFor } from '../lib/secrets'
import { wallet } from '../lib/wallet'
import { type ListWallet } from '../stores/state'
import { useStateStore, useWalletStore } from '../stores'
import DoneView from './DoneView.vue'
import ProgressView from './ProgressView.vue'

const route = useRoute()
const router = useRouter()
const flow = useStateStore()
const wallets = useWalletStore()

type Tab = 'single' | 'list'
const tab = computed<Tab>(() => (route.query.mode === 'list' ? 'list' : 'single'))

function setTab(next: Tab) {
  if (next === tab.value) return
  void router.replace({ query: { ...route.query, mode: next === 'list' ? 'list' : undefined } })
}

/* List results belong to list mode — but never take over a single-wallet result, run or receipt. */
watch(tab, (t) => {
  if (t === 'list' && flow.bulkList.length && flow.screen === 'hero') flow.mode = 'bulk'
}, { immediate: true })

/* ---------------- single wallet ---------------- */

const address = ref('')
const keyText = ref('')
const keyOpen = ref(false)
let scanOnConnect = false

function checkAddress() {
  flow.input = address.value
  flow.startScan(address.value)
}

function checkWithKey() {
  const raw = keyText.value
  keyText.value = ''
  if (raw.trim()) flow.startScan(raw, { allowSecret: true })
}

function useConnected() {
  if (wallet.publicKey) {
    flow.startScan(wallet.publicKey, { kind: 'connected' })
    return
  }
  scanOnConnect = true
  wallets.open('scan')
}

watch(() => wallets.pickerOpen, (open) => {
  if (open || !scanOnConnect) return
  scanOnConnect = false
  if (wallet.publicKey) flow.startScan(wallet.publicKey, { kind: 'connected' })
})

function demo() {
  flow.startScan('demo')
}

/* ---------------- wallet list ---------------- */

const listText = ref(flow.bulkList.length ? flow.bulkList.filter((w) => w.kind === 'address').map((w) => w.addr).join('\n') : '')
const fileInput = ref<HTMLInputElement | null>(null)
const check = computed(() => checkAddressList(listText.value))
const showIssues = ref(false)

/* Imported keys: parsed straight into memory, never kept in reactive state. */
const keysText = ref('')
const keysOpen = ref(false)
const keyFrom = ref(0)
const keyTo = ref(9)
const keyWallets = ref<ListWallet[]>(flow.bulkList.filter((w) => w.kind !== 'address' && secretFor(w.addr)))
const keysErr = ref('')
const keysHaveSeed = computed(() => textHasSeed(keysText.value))

function importKeys() {
  keysErr.value = ''
  const parsed = parseBulkText(keysText.value, clampRange(keyFrom.value, keyTo.value))
  const withSecret = parsed.filter((w) => w.secret)
  if (!withSecret.length) {
    keysErr.value = 'No private keys or seed phrases found. Addresses go in the list above.'
    return
  }
  const have = new Set(keyWallets.value.map((w) => w.addr))
  for (const w of withSecret) {
    rememberSecret(w.addr, w.secret!)
    if (!have.has(w.addr)) keyWallets.value.push({ addr: w.addr, kind: w.kind === 'seed' ? 'seed' : 'key' })
  }
  keysText.value = ''
}

function dropKeys() {
  for (const w of keyWallets.value) forgetSecret(w.addr)
  keyWallets.value = []
}

const runList = computed<ListWallet[]>(() => {
  const out: ListWallet[] = []
  const seen = new Set<string>()
  for (const w of keyWallets.value) {
    if (seen.has(w.addr)) continue
    seen.add(w.addr)
    out.push(w)
  }
  for (const v of check.value.valid) {
    if (seen.has(v.addr)) continue
    seen.add(v.addr)
    out.push({ addr: v.addr, kind: 'address' })
  }
  return out
})

function startList() {
  if (!runList.value.length || flow.busy) return
  void flow.runBulk(runList.value)
}

function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  void file.text().then((body) => {
    listText.value = body
    input.value = ''
  })
}

function demoList() {
  if (!flow.cfg.demoAddress) return
  listText.value = flow.cfg.demoAddress
}

/* ---------------- results ---------------- */

const rowsByAddr = computed(() => new Map(flow.bulkRows.map((r) => [r.addr, r])))
const checked = computed(() => flow.bulkRows.length + Object.keys(flow.bulkErrors).length)
const failedCount = computed(() => Object.keys(flow.bulkErrors).length)

type RowStatus = 'wait' | 'bad' | 'ok' | 'none'

const table = computed(() => flow.bulkList.map((w) => {
  const r = rowsByAddr.value.get(w.addr)
  const error = flow.bulkErrors[w.addr]
  let status: RowStatus = 'wait'
  let label = flow.busy ? 'Checking' : 'Not checked'
  if (error) { status = 'bad'; label = 'Couldn’t check' }
  else if (r && bulkHasWork(r, flow.bulkExcess)) { status = 'ok'; label = 'Ready' }
  else if (r) { status = 'none'; label = 'No empty accounts' }
  const notes: string[] = []
  if (w.kind !== 'address' && secretFor(w.addr)) notes.push(w.kind === 'seed' ? 'from seed · signs here' : 'key · signs here')
  if (r?.noSol && r.empty) notes.push(flow.cfg.treasuryPaysGas ? 'no SOL for network fees — Grabster covers, withheld' : 'no SOL for network fees')
  if (r?.frozen) notes.push(`${r.frozen} frozen`)
  if (r?.excess && flow.cfg.features.excessRent) notes.push(`${r.excess} with extra rent`)
  return { w, r, error, status, label, notes }
}))

const withWork = computed(() => flow.bulkRows.filter((r) => bulkHasWork(r, flow.bulkExcess)))
/** List totals straight from the list rows, whatever the single-wallet flow last did. */
const tot = computed(() => bulkTotals(flow.bulkRows, flow.dest, flow.cfg, flow.bulkExcess))
const emptyTotal = computed(() => flow.bulkRows.reduce((s, r) => s + r.empty, 0))
const excessRows = computed(() => flow.bulkRows.filter((r) => r.excess > 0))
const excessSol = computed(() => excessRows.value.reduce((s, r) => s + r.excessSol, 0))

/* Network fees: wallets that hold SOL pay their own; for empty wallets Grabster can pay and withholds it. */
const gas = computed(() => {
  let wallet = 0
  let withheld = 0
  for (const r of withWork.value) {
    const split = { emptyBoxes: r.empty, dustBoxes: 0, nftBoxes: 0, refundBoxes: flow.bulkExcess ? r.excess : 0, sweep: false }
    const covered = Boolean(flow.cfg.treasuryPaysGas && r.noSol)
    if (covered) withheld += treasuryGasWithholdSol(r.empty, flow.cfg, true, split)
    else wallet += networkFeeSol(r.empty, flow.dest, flow.cfg, split)
  }
  return { wallet, withheld }
})

const recipient = computed(() => {
  if (flow.dest === 'balance') return 'Your Grabster balance (held by Grabster)'
  if (flow.dest === 'other') return flow.other ? short(flow.other) : 'Enter an address'
  return 'Each wallet keeps its own SOL'
})

const signers = computed(() => {
  const keys = withWork.value.filter((r) => secretFor(r.addr)).length
  return { keys, extension: withWork.value.length - keys }
})

const listDone = computed(() => !flow.busy && flow.bulkList.length > 0 && checked.value >= flow.bulkList.length)
/** Long lists bury the Action block — put review above the wallet table past this size. */
const REVIEW_BEFORE_WALLETS = 8
const reviewBeforeWallets = computed(() => flow.bulkList.length >= REVIEW_BEFORE_WALLETS)

function exportResults() {
  const lines = ['wallet,empty_accounts,estimated_rent_sol,status,error']
  for (const t of table.value) {
    lines.push([
      t.w.addr,
      String(t.r?.empty ?? ''),
      t.r ? t.r.emptySol.toFixed(9) : '',
      t.label,
      t.error ? `"${t.error.replace(/"/g, "'")}"` : '',
    ].join(','))
  }
  downloadCsv('grabster-check.csv', lines.join('\n'))
}

function startReview() {
  flow.mode = 'bulk'
  flow.openClaim()
}

function newList() {
  if (flow.busy) return
  flow.reset()
  flow.mode = 'bulk'
  keyWallets.value = []
}
</script>

<template>
  <ProgressView v-if="flow.mode === 'bulk' && flow.screen === 'progress'" />
  <DoneView v-else-if="flow.mode === 'bulk' && flow.screen === 'done'" />
  <section v-else class="screen cleanup">
    <div class="top">
      <header class="intro">
        <h1>Reclaim SOL from empty token accounts.</h1>
        <p class="lede">
          Check one wallet or a whole list. Checking only reads public chain data — nothing moves until the wallet owner signs.
        </p>
      </header>

      <div class="work">
        <div class="tabs" role="tablist" aria-label="Cleanup mode">
          <button id="tab-single" type="button" role="tab" :aria-selected="tab === 'single'" aria-controls="panel-single" @click="setTab('single')">Single wallet</button>
          <button id="tab-list" type="button" role="tab" :aria-selected="tab === 'list'" aria-controls="panel-list" @click="setTab('list')">Wallet list</button>
        </div>

        <!-- ================= Single wallet ================= -->
        <div v-if="tab === 'single'" id="panel-single" class="panel-body" role="tabpanel" aria-labelledby="tab-single">
          <form class="single" @submit.prevent="checkAddress">
            <label class="field-label" for="addr">Wallet address</label>
            <div class="inline">
              <input
                id="addr"
                v-model="address"
                class="input"
                autocomplete="off"
                spellcheck="false"
                placeholder="Paste a public Solana address"
              />
              <button class="btn arrow" type="submit" :disabled="flow.busy">Check wallet</button>
            </div>
            <p v-if="flow.err" class="err" role="alert">{{ flow.err }}</p>
            <div class="alt">
              <button class="btn btn-ghost btn-sm" type="button" @click="useConnected">
                {{ wallet.publicKey ? `Check connected wallet ${short(wallet.publicKey)}` : 'Connect wallet' }}
              </button>
              <button v-if="flow.cfg.demoAddress" class="link" type="button" @click="demo">Try a demo wallet</button>
            </div>
            <p class="hint">Checking needs only the public address. No key, no signature.</p>
          </form>

          <section class="keybox" :class="{ open: keyOpen }">
            <button class="keybox-toggle" type="button" :aria-expanded="keyOpen" aria-controls="single-key" @click="keyOpen = !keyOpen">
              <span>Sign with a private key instead</span><span class="mono" aria-hidden="true">{{ keyOpen ? '−' : '+' }}</span>
            </button>
            <div v-if="keyOpen" id="single-key" class="keybox-body">
              <p class="muted">
                The key stays in this browser tab’s memory and signs here. It is never sent to Grabster and is dropped when you
                reload. For many keys, use the <a href="/local" @click.prevent="router.push('/local')">local file</a>.
              </p>
              <div class="inline">
                <label class="sr-only" for="single-key-input">Private key or seed phrase</label>
                <!-- Not a password field and not in a form, so password managers don't offer to save the key. -->
                <input
                  id="single-key-input"
                  v-model="keyText"
                  class="input masked"
                  type="text"
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck="false"
                  data-1p-ignore
                  data-lpignore="true"
                  data-bwignore
                  data-form-type="other"
                  placeholder="Base58 key, JSON byte array, or seed phrase"
                  @keydown.enter.prevent="checkWithKey"
                />
                <button class="btn btn-ghost" type="button" :disabled="!keyText.trim()" @click="checkWithKey">Check</button>
              </div>
            </div>
          </section>
        </div>

        <!-- ================= Wallet list ================= -->
        <div v-else id="panel-list" class="panel-body" role="tabpanel" aria-labelledby="tab-list">
          <div class="list-input">
            <label class="field-label" for="list">Wallet addresses <small>one per line, or a CSV with an address column</small></label>
            <textarea
              id="list"
              v-model="listText"
              class="input list-text"
              spellcheck="false"
              placeholder="One public address per line"
              aria-describedby="list-check"
            ></textarea>
            <div class="list-tools">
              <button class="btn btn-ghost btn-sm" type="button" @click="fileInput?.click()">Load CSV</button>
              <button v-if="flow.cfg.demoAddress" class="btn btn-ghost btn-sm" type="button" @click="demoList">Use demo address</button>
              <button v-if="listText" class="link" type="button" @click="listText = ''">Clear</button>
              <input ref="fileInput" type="file" accept=".csv,.txt,text/plain,text/csv" hidden @change="onFile" />
            </div>

            <div id="list-check" class="check" aria-live="polite">
              <p>
                <b class="num">{{ check.valid.length }}</b> valid
                <span class="sep" aria-hidden="true">·</span><span class="num">{{ check.duplicates.length }}</span> duplicate{{ check.duplicates.length === 1 ? '' : 's' }}
                <span class="sep" aria-hidden="true">·</span><span class="num" :class="{ warn: check.invalid.length }">{{ check.invalid.length }}</span> invalid
                <template v-if="check.secrets.length"><span class="sep" aria-hidden="true">·</span><span class="num warn">{{ check.secrets.length }}</span> with a key</template>
              </p>
              <button
                v-if="check.duplicates.length || check.invalid.length || check.secrets.length"
                class="link"
                type="button"
                :aria-expanded="showIssues"
                @click="showIssues = !showIssues"
              >{{ showIssues ? 'Hide details' : 'Show details' }}</button>
            </div>
            <p v-if="check.secrets.length" class="callout secret-warn">
              Lines {{ check.secrets.join(', ') }} contain a private key or seed phrase. The keys were ignored here
              (any address on those lines is kept). To sign with keys, put them in <b>Import keys</b> instead.
            </p>
            <ul v-if="showIssues" class="issues">
              <li v-for="d in check.duplicates" :key="'d' + d.addr"><span class="mono">{{ short(d.addr) }}</span> repeated on lines {{ d.lines.join(', ') }} — kept once</li>
              <li v-for="x in check.invalid" :key="'i' + x.line"><span class="mono">line {{ x.line }}</span> {{ x.text }} — {{ x.reason }}</li>
            </ul>
          </div>

          <section class="keybox" :class="{ open: keysOpen }">
            <button class="keybox-toggle" type="button" :aria-expanded="keysOpen" aria-controls="list-keys" @click="keysOpen = !keysOpen">
              <span>Import keys <small class="muted">signs in this browser</small></span><span class="mono" aria-hidden="true">{{ keysOpen ? '−' : '+' }}</span>
            </button>
            <div v-if="keysOpen" id="list-keys" class="keybox-body">
              <p class="muted">
                Only if you want this tab to sign without switching wallet accounts. Keys and seed phrases stay in this tab’s memory,
                are never sent to Grabster, and are dropped on reload. For a large set of keys, the
                <a href="/local" @click.prevent="router.push('/local')">local file</a> is the recommended path.
              </p>
              <label class="sr-only" for="keys">Private keys or seed phrases</label>
              <textarea
                id="keys"
                v-model="keysText"
                class="input masked"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore
                data-form-type="other"
                rows="4"
                spellcheck="false"
                autocomplete="off"
                placeholder="One key or seed phrase per line. CSV: key|seed|address"
              ></textarea>
              <div v-if="keysHaveSeed" class="range">
                <label>Accounts <input v-model.number="keyFrom" class="input range-n" type="number" min="0" max="50" aria-label="First account index" /></label>
                <label>to <input v-model.number="keyTo" class="input range-n" type="number" min="0" max="50" aria-label="Last account index" /></label>
                <span class="muted">Phantom / Solflare and Ledger paths</span>
              </div>
              <div class="list-tools">
                <button class="btn btn-ghost btn-sm" type="button" :disabled="!keysText.trim()" @click="importKeys">Add keys</button>
                <span v-if="keyWallets.length" class="muted">{{ keyWallets.length }} wallet{{ keyWallets.length === 1 ? '' : 's' }} from keys</span>
                <button v-if="keyWallets.length" class="link" type="button" @click="dropKeys">Remove</button>
              </div>
              <p v-if="keysErr" class="err">{{ keysErr }}</p>
            </div>
          </section>

          <div class="ready">
            <p class="ready-n num" aria-label="Ready to check">{{ runList.length }}<small> ready<br />to check</small></p>
            <div class="ready-go">
              <button class="btn btn-lg arrow" type="button" :disabled="!runList.length || flow.busy" @click="startList">
                {{ flow.busy ? 'Checking…' : runList.length ? `Check ${runList.length} wallet${runList.length === 1 ? '' : 's'}` : 'Add addresses to check' }}
              </button>
              <p class="hint">Read-only. Duplicates and invalid lines are left out.</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- results: full width below the working area -->
    <section
      v-if="tab === 'list' && flow.bulkList.length"
      class="results"
      :class="{ 'review-first': reviewBeforeWallets }"
      aria-labelledby="results-title"
    >
      <div class="results-head">
        <h2 id="results-title">Results</h2>
        <p class="muted" aria-live="polite">
          <span class="num">{{ checked }}</span> of <span class="num">{{ flow.bulkList.length }}</span> checked
          <template v-if="flow.busy"> · checking…</template>
        </p>
        <div class="results-actions">
          <button v-if="failedCount && !flow.busy" class="btn btn-ghost btn-sm" type="button" @click="flow.retryFailed()">Retry failed ({{ failedCount }})</button>
          <button v-if="checked" class="btn btn-ghost btn-sm" type="button" @click="exportResults">Export CSV</button>
          <button class="link" type="button" :disabled="flow.busy" @click="newList">New list</button>
        </div>
      </div>

      <div class="stats-row">
        <div><b>{{ checked }}</b><small>Wallets checked</small></div>
        <div><b>{{ withWork.length }}</b><small>With empty accounts</small></div>
        <div><b>{{ emptyTotal }}</b><small>Empty accounts</small></div>
        <div><b>{{ fmt(tot.gross) }}</b><small>Estimated rent · SOL</small></div>
        <div v-if="failedCount"><b class="bad">{{ failedCount }}</b><small>Couldn’t check</small></div>
      </div>

      <div class="tscroll">
        <table class="table">
          <thead>
            <tr>
              <th scope="col">Wallet</th>
              <th scope="col" class="num">Empty accounts</th>
              <th scope="col" class="num">Estimated rent</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in table" :key="t.w.addr">
              <td class="mono" :title="t.w.addr">{{ short(t.w.addr) }}</td>
              <td class="num">{{ t.r ? t.r.empty : '—' }}</td>
              <td class="num">{{ t.r ? `${fmt(t.r.emptySol)} SOL` : '—' }}</td>
              <td>
                <span class="status" :data-s="t.status">{{ t.label }}</span>
                <small v-if="t.error" class="row-note bad">{{ t.error }}</small>
                <small v-for="n in t.notes" :key="n" class="row-note">{{ n }}</small>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- review: after the table by default; before it when the list is long (see .review-first) -->
      <section v-if="listDone && withWork.length" class="review" aria-labelledby="review-title">
        <p class="kicker"><span>Review</span>Before anything is signed</p>
        <div class="review-grid">
          <div>
            <h3 id="review-title">Action</h3>
            <p class="action">
              Close <b class="num">{{ emptyTotal }}</b> empty token account{{ emptyTotal === 1 ? '' : 's' }}
              in <b class="num">{{ withWork.length }}</b> wallet{{ withWork.length === 1 ? '' : 's' }}. Tokens with a balance are not touched.
            </p>
            <label v-if="flow.cfg.features.excessRent && excessRows.length" class="opt">
              <input v-model="flow.bulkExcess" type="checkbox" />
              <span>
                Also withdraw extra rent from accounts that stay open
                <small class="muted">{{ excessRows.length }} wallet{{ excessRows.length === 1 ? '' : 's' }} · +{{ fmt(excessSol) }} SOL · separate operation, off by default</small>
              </span>
            </label>

            <h3 class="sub">Where the SOL goes</h3>
            <DestinationChoices allow-same list />
          </div>

          <div>
            <h3>Estimate</h3>
            <dl class="kv">
              <div><dt>Gross recovery</dt><dd>{{ fmt(tot.gross) }} SOL<Bucks :sol="tot.gross" paren /></dd></div>
              <div><dt>Grabster fee · {{ tot.fee }}%</dt><dd>−{{ fmt(tot.feeSol, 6) }} SOL</dd></div>
              <div v-if="gas.withheld"><dt>Network fee · paid by Grabster, withheld</dt><dd>−{{ fmt(gas.withheld, 6) }} SOL</dd></div>
              <div v-if="gas.wallet"><dt>Network fee · paid by each wallet from its SOL</dt><dd>~{{ fmt(gas.wallet, 6) }} SOL</dd></div>
              <div><dt>Recipient</dt><dd class="text">{{ recipient }}</dd></div>
              <div class="total"><dt>Estimated net</dt><dd>{{ fmt(tot.net) }} SOL<Bucks :sol="tot.net" paren /></dd></div>
            </dl>
            <p class="hint">
              Estimated from the scan. Exact amounts come from each wallet’s plan, built right before it signs.
              <template v-if="gas.wallet"> Wallet-paid network fees are not taken from the payout.</template>
            </p>

            <h3 class="sub">Who signs</h3>
            <ul class="signers">
              <li v-if="signers.keys"><b class="num">{{ signers.keys }}</b> with imported keys — signed in this tab, no prompts.</li>
              <li v-if="signers.extension">
                <b class="num">{{ signers.extension }}</b> through a wallet extension — one at a time. You switch to each account in
                Phantom or Solflare and approve its transactions.
              </li>
            </ul>
            <button class="btn btn-lg arrow" type="button" @click="startReview">Review cleanup</button>
          </div>
        </div>
      </section>
      <p v-else-if="listDone && !withWork.length" class="callout none-left">
        No empty token accounts in the wallets that were checked<template v-if="failedCount">. {{ failedCount }} couldn’t be checked — retry them above</template>.
      </p>
    </section>
  </section>
</template>

<style scoped lang="scss">
/* Edge to edge like the other inner pages: cancel main's gutter and bottom padding. */
.cleanup {
  width: calc(100% + 2 * var(--gutter));
  max-width: none;
  margin: 0 calc(-1 * var(--gutter)) -64px;
  /* Fills the page height so the column rule runs down to the footer, even before there are results. */
  display: flex;
  flex-direction: column;
}

/* Fields on this page are the copyable surface: white in light, a dark surface in dark. */
.input { background: var(--field); }

/* ---------- top: heading on the left, the whole working area on the right ---------- */
.top {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
  align-items: stretch;
  flex: 1 0 auto;

  @media (max-width: 900px) { grid-template-columns: minmax(0, 1fr); }
}

.intro {
  min-width: 0;
  padding: 32px var(--gutter) 40px;
  border-right: 1px solid var(--line-2);

  h1 { font-size: clamp(44px, 5.4vw, 88px); max-width: 11ch; }
  .lede { margin-top: 24px; font-size: clamp(17px, 1.4vw, 20px); line-height: 1.35; max-width: 42ch; }

  @media (max-width: 900px) {
    padding: 28px var(--gutter) 32px;
    border-right: 0;
    border-bottom: 1px solid var(--line-2);

    h1 { max-width: 14ch; }
  }

  @media (max-width: 640px) {
    h1 { font-size: clamp(40px, 12vw, 56px); }
    .lede { margin-top: 18px; }
  }
}

.work {
  min-width: 0;
  display: flex;
  flex-direction: column;

  @media (max-width: 900px) { border-bottom: 1px solid var(--line-2); }
}

/* The mode switch: a strip across the top of the working area, two equal cells. */
.work > .tabs {
  flex: none;
  border: 0;
  border-bottom: 1px solid var(--line-2);

  > button {
    flex: 1 1 0;
    justify-content: flex-start;
    min-height: 56px;
    padding: 0 var(--gutter);
    border-right: 1px solid var(--line-2);
    font-size: 18px;
    letter-spacing: -0.02em;

    &:last-child { border-right: 0; }
  }
}

/* Same footprint in both modes, so switching tabs doesn't make the page jump. */
.panel-body {
  flex: 1;
  min-width: 0;
  padding: 28px var(--gutter) 32px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  align-content: start;

  @media (min-width: 901px) { min-height: 516px; }
  @media (max-width: 640px) { padding: 24px var(--gutter) 28px; }
}

.single .field-label { margin-bottom: 10px; }

/* Field and its button butt together into one rectangle. */
.inline {
  display: flex;
  align-items: stretch;

  .input { flex: 1; }

  .btn { flex: none; margin-left: -1px; }

  @media (max-width: 560px) {
    flex-direction: column;

    .btn { margin: -1px 0 0; }
  }
}

.single .inline {
  .input { min-height: 60px; font-size: 16px; padding: 0 18px; }
  .btn { min-height: 60px; min-width: 188px; font-size: 17px; padding-left: 18px; }
  .btn.arrow::after { width: 60px; }

  @media (max-width: 560px) {
    .input { min-height: 56px; }
    .btn { min-height: 56px; min-width: 0; }
    .btn.arrow::after { width: 56px; }
  }
}

.alt {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 20px;
  margin-top: 16px;
}

/* Disclosure: a framed rectangle with the +/− in its own cell, like the home FAQ. */
.keybox {
  border: 1px solid var(--line-3);
  min-width: 0;
  flex: none;
}

.keybox-toggle {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 52px;
  align-items: stretch;
  min-height: 52px;
  padding: 0;
  background: none;
  border: 0;
  color: var(--ink);
  font-size: 16px;
  font-weight: 500;
  letter-spacing: -0.015em;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s;

  > span:first-child {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 2px 10px;
    padding: 12px 20px;
  }

  small { font-size: 14px; font-weight: 400; letter-spacing: 0; }

  .mono {
    display: grid;
    place-items: center;
    border-left: 1px solid var(--line-3);
    font-size: 20px;
    color: var(--ink);
  }

  &:hover { background: var(--surface); }

  &:focus-visible { outline-offset: -3px; }

  &[aria-expanded='true'] {
    border-bottom: 1px solid var(--line-3);

    .mono { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
  }
}

.keybox-body {
  display: grid;
  gap: 14px;
  padding: 20px;
  background: var(--surface);

  p { font-size: 15px; color: var(--ink-2); }
  a { color: var(--ink); text-underline-offset: 3px; }
  a:hover { color: var(--accent-text); }

  .inline .btn { min-width: 120px; }
}

.masked { -webkit-text-security: disc; }
textarea.masked { min-height: 110px; }

/* ---------- wallet list ---------- */
.list-input { min-width: 0; }

.list-text { min-height: 120px; height: 120px; font-size: 13px; resize: vertical; }

.list-tools {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 14px;
  margin-top: 10px;
}

.check {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin-top: 14px;
  padding: 10px 0;
  border-top: 1px solid var(--line-2);
  border-bottom: 1px solid var(--line-2);
  font-size: 15px;
  color: var(--muted);

  b { color: var(--ink); font-weight: 500; }
  .sep { margin: 0 8px; color: var(--muted); }
  .warn { color: var(--bad); }
}

.secret-warn { margin-top: 14px; font-size: 14px; }

.issues {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 160px;
  overflow: auto;
  font-size: 13.5px;
  color: var(--muted);
  border-bottom: 1px solid var(--line-2);

  li { padding: 8px 0; border-top: 1px solid var(--line); }
  li:first-child { border-top: 0; }

  .mono { color: var(--ink-2); margin-right: 6px; }
}

/* The count and the main action in one row; pushed to the bottom of the working area. */
.ready {
  margin-top: auto;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: end;
  gap: 8px 24px;
  padding-top: 16px;
  border-top: 1px solid var(--line-2);

  .ready-n {
    display: flex;
    align-items: baseline;
    gap: 10px;
    font-family: var(--display);
    font-weight: 500;
    font-size: clamp(56px, 5.4vw, 84px);
    letter-spacing: -0.045em;
    line-height: 0.9;

    small { font-family: var(--body); font-size: 14px; font-weight: 500; line-height: 1.2; color: var(--muted); letter-spacing: -0.005em; }
  }

  .ready-go .hint { margin-top: 8px; }

  @media (max-width: 560px) {
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
  }
}

.range {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  font-size: 14px;
  color: var(--ink-2);

  label { display: flex; align-items: center; gap: 8px; }
}

.range-n {
  width: 76px;
  min-height: 44px;
  padding: 6px 8px;
  text-align: center;
}

/* ---------- results ---------- */
/* Flex so long lists can move Action above the wallet table via order. */
.results {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0 var(--gutter);
  border-top: 1px solid var(--line-2);

  > .results-head { order: 0; }
  > .stats-row { order: 1; }
  > .tscroll { order: 2; }
  > .review,
  > .none-left { order: 3; }

  &.review-first {
    > .review { order: 2; }
    > .tscroll { order: 3; }
  }
}

.results-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 12px 24px;
  padding: 48px 0 24px;

  h2 { font-size: clamp(44px, 5.6vw, 88px); font-weight: 600; }

  > p { font-size: 16px; }

  @media (max-width: 640px) { padding: 36px 0 20px; }
}

.results-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px 14px;
  flex-wrap: wrap;

  @media (max-width: 640px) { margin-left: 0; }
}

.stats-row { margin-bottom: 0; }

.results > .tscroll {
  /* Rows run edge to edge like the figures above; the first and last cell keep the gutter. */
  margin: 0 calc(-1 * var(--gutter));
  max-width: none;
}

.results > .tscroll .table {
  border-top: 0;

  th:first-child,
  td:first-child { padding-left: var(--gutter); }

  th:last-child,
  td:last-child { padding-right: var(--gutter); }
}

/* When review sits above the table, restore the table’s top rule (it no longer follows the stats). */
.results.review-first > .tscroll .table {
  border-top: 1px solid var(--line-2);
}

.bad { color: var(--bad); }

.row-note {
  display: block;
  margin-top: 4px;
  color: var(--muted);
  font-size: 13px;

  &.bad { color: var(--bad); }
}

/* Review: its own band with a label strip and two columns on a rule. */
.review {
  margin: 56px calc(-1 * var(--gutter)) 0;
  border-top: 1px solid var(--line-2);

  .kicker {
    min-height: 48px;
    padding-right: var(--gutter);
    border-bottom: 1px solid var(--line-2);
    gap: 16px;

    span {
      align-self: stretch;
      display: flex;
      align-items: center;
      padding: 0 var(--gutter);
      border-right: 1px solid var(--line-2);
    }
  }
}

.review-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);

  > div {
    min-width: 0;
    padding: 40px var(--gutter) 64px;
  }

  > div + div { border-left: 1px solid var(--line-2); }

  h3 { margin-bottom: 20px; font-size: clamp(28px, 2.8vw, 40px); }
  h3.sub { margin-top: 48px; }

  @media (max-width: 900px) {
    grid-template-columns: minmax(0, 1fr);

    > div { padding: 32px var(--gutter) 40px; }
    > div + div { border-left: 0; border-top: 1px solid var(--line-2); }
  }
}

.action {
  color: var(--ink-2);
  font-size: 18px;
  line-height: 1.4;

  b { color: var(--ink); font-weight: 600; }
}

.opt {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 14px;
  margin-top: 20px;
  padding: 16px 0;
  border-top: 1px solid var(--line-2);
  border-bottom: 1px solid var(--line-2);
  cursor: pointer;
  font-size: 15px;

  input { margin-top: 2px; }
  small { display: block; margin-top: 4px; font-size: 13.5px; }
}

.signers {
  list-style: none;
  margin: 0 0 28px;
  padding: 0;
  border-top: 1px solid var(--line-2);
  color: var(--ink-2);
  font-size: 15px;

  li { padding: 12px 0; border-bottom: 1px solid var(--line-2); }

  b { color: var(--ink); font-weight: 600; margin-right: 4px; }
}

.none-left { margin: 32px 0 64px; }
</style>
