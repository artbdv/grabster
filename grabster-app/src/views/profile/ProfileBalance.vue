<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Bucks from '../../components/Bucks.vue'
import Icon from '../../components/Icon.vue'
import { fmt, short, solscanTx, withBucks } from '../../lib/mock'
import { loadBook, requestWithdraw } from '../../lib/siws'
import type { BalanceBook } from '../../lib/api'
import { useAuthStore, useStateStore, useUiStore } from '../../stores'

const ui = useUiStore()
const auth = useAuthStore()
const flow = useStateStore()
const book = ref<BalanceBook | null>(null)
const err = ref('')
const loading = ref(false)
const busy = ref(false)
const amount = ref('')
/** The last withdrawal sent from this screen; its live status comes from the ledger row. */
const last = ref<{ signature: string; sentSol: number; feeSol: number } | null>(null)

const want = computed(() => Number(String(amount.value).replace(',', '.')) || 0)
const fee = computed(() => book.value?.withdraw.feeSol ?? 0)
const receive = computed(() => Math.max(0, want.value - fee.value))
const canOut = computed(() => {
  const w = book.value?.withdraw
  if (!w || busy.value) return false
  return want.value >= w.minSol && want.value <= w.maxSol + 1e-12
})

const lastState = computed(() => {
  const sent = last.value
  if (!sent) return null
  const row = book.value?.rows.find((r) => r.kind === 'withdraw' && r.signatures.includes(sent.signature))
  if (row?.status === 'available') return { s: 'ok', label: 'Confirmed' }
  if (row?.status === 'failed') return { s: 'bad', label: 'Failed' }
  return { s: 'wait', label: 'Sending' }
})

watch(() => auth.address, () => {
  last.value = null
  void refresh()
}, { immediate: true })

async function refresh() {
  err.value = ''
  if (!auth.address) {
    book.value = null
    loading.value = false
    return
  }
  loading.value = true
  try {
    book.value = await loadBook()
  } catch (e) {
    book.value = null
    err.value = e instanceof Error ? e.message : 'Could not load the balance.'
  } finally {
    loading.value = false
  }
}

function setMax() {
  const w = book.value?.withdraw
  if (!w || w.maxSol < w.minSol) return
  amount.value = String(Math.floor(w.maxSol * 1e9) / 1e9)
}

async function cashOut() {
  if (!canOut.value) return
  busy.value = true
  err.value = ''
  try {
    const paid = await requestWithdraw(want.value)
    last.value = { signature: paid.signature, sentSol: paid.sentSol, feeSol: paid.feeSol }
    ui.showToast(`Sent ${withBucks(paid.sentSol, flow.solUsd)}`)
    book.value = await loadBook()
    amount.value = ''
  } catch (e) {
    err.value = e instanceof Error ? e.message : 'Could not withdraw.'
    ui.showToast(err.value)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="pane">
    <section class="page-section" aria-labelledby="bal-title">
      <div class="kicker-row">
        <p class="kicker"><span>01</span>Grabster balance</p>
        <button class="icon-btn" type="button" aria-label="Refresh balance" :disabled="busy || loading" @click="refresh">
          <Icon name="refresh" small />
        </button>
      </div>

      <div class="split">
        <div>
          <h2 id="bal-title">SOL Grabster holds for this wallet.</h2>
          <p class="muted intro">
            When a cleanup sends recovered SOL to Grabster balance, it is recorded here instead of landing in a wallet you
            control. That route carries a {{ flow.cfg.feeBalance }}% Grabster fee. Withdrawals always go to the wallet you
            signed in with.
          </p>
        </div>

        <div v-if="book">
          <div class="stats-row">
            <div><b>{{ fmt(book.availableSol) }}</b><small>Available · SOL<Bucks :sol="book.availableSol" paren /></small></div>
            <div><b>{{ fmt(book.pendingSol) }}</b><small>In transit · SOL<Bucks :sol="book.pendingSol" paren /></small></div>
          </div>
        </div>
        <div v-else aria-live="polite">
          <p v-if="loading" class="muted">Loading your balance…</p>
          <template v-else-if="err">
            <p class="err">{{ err }}</p>
            <button class="btn btn-sm btn-ghost retry" type="button" @click="refresh">Try again</button>
          </template>
        </div>
      </div>
    </section>

    <section v-if="book" class="page-section" aria-labelledby="wd-title">
      <p class="kicker"><span>02</span>Withdraw</p>
      <h2 id="wd-title" class="sr-only">Withdraw</h2>

      <div class="split">
        <div class="cashout">
          <label class="field-label" for="wd-amount">Amount <small>SOL</small></label>
          <div class="cash-row">
            <input
              id="wd-amount"
              class="input"
              inputmode="decimal"
              autocomplete="off"
              placeholder="0.00"
              aria-describedby="wd-rules"
              :value="amount"
              @input="amount = ($event.target as HTMLInputElement).value"
            />
            <button class="btn btn-ghost btn-sm max" type="button" @click="setMax">Max</button>
          </div>
          <button class="btn btn-lg arrow" type="button" :disabled="!canOut" @click="cashOut">
            <span v-if="busy">Sending…</span>
            <span v-else-if="canOut">Withdraw {{ fmt(want) }} SOL</span>
            <span v-else-if="book.withdraw.maxSol < book.withdraw.minSol">Need {{ fmt(book.withdraw.minSol) }} SOL to withdraw</span>
            <span v-else>Withdraw</span>
          </button>

          <div class="op" aria-live="polite">
            <p v-if="busy" class="status" data-s="wait">Sending to {{ short(auth.address) }}</p>
            <template v-else-if="last && lastState">
              <p class="status" :data-s="lastState.s">{{ lastState.label }}</p>
              <p class="op-line">
                {{ fmt(last.sentSol) }} SOL to <span class="mono">{{ short(auth.address) }}</span>
                <template v-if="last.feeSol"> · fee {{ fmt(last.feeSol) }} SOL</template>
                ·
                <a class="link mono" :href="solscanTx(last.signature)" target="_blank" rel="noopener noreferrer">{{ short(last.signature) }}</a>
              </p>
              <p v-if="lastState.s === 'wait'" class="muted op-note">Use refresh above to update the status.</p>
            </template>
            <p v-if="err" class="err">{{ err }}</p>
          </div>
        </div>

        <div>
          <dl id="wd-rules" class="kv">
            <div><dt>Recipient</dt><dd><span class="mono" :title="auth.address">{{ short(auth.address) }}</span> <span class="muted">signed-in wallet</span></dd></div>
            <div><dt>Available</dt><dd>{{ fmt(book.withdraw.availableSol) }} SOL</dd></div>
            <div><dt>Minimum</dt><dd>{{ fmt(book.withdraw.minSol) }} SOL</dd></div>
            <div><dt>Withdraw fee</dt><dd>{{ fmt(book.withdraw.feeSol) }} SOL</dd></div>
            <div><dt>Network fee</dt><dd>Paid by Grabster</dd></div>
            <div><dt>Left today</dt><dd>{{ fmt(book.withdraw.leftSol) }} of {{ fmt(book.withdraw.dailySol) }} SOL</dd></div>
            <div class="total"><dt>You receive</dt><dd>{{ fmt(receive) }} SOL<Bucks :sol="receive" paren /></dd></div>
          </dl>
        </div>
      </div>

      <p class="hint">
        Every credit and withdrawal, with its transaction, is in
        <router-link class="link" to="/profile/activity">Activity</router-link>.
      </p>
    </section>
  </div>
</template>

<style scoped lang="scss">
h2 { max-width: 14ch; }

.intro {
  margin-top: 24px;
  font-size: 16px;
  color: var(--ink-2);
  max-width: 52ch;
}

.stats-row small :deep(.bucks) {
  font-family: var(--body);
  letter-spacing: 0;
  text-transform: none;
}

.retry { margin-top: 12px; }

.cashout {
  display: grid;
  align-content: start;
  gap: 14px;
  min-width: 0;

  .field-label { margin: 0; }
}

/* Amount field and Max butt together. */
.cash-row {
  display: flex;
  align-items: stretch;
  width: 100%;

  .input { flex: 1; min-height: 64px; font-size: 22px; }

  .max {
    flex: none;
    min-width: 80px;
    min-height: 64px;
    justify-content: center;
    margin-left: -1px;
  }
}

.op {
  display: grid;
  gap: 6px;
  min-height: 24px;

  .err { margin-top: 0; }
}

.op-line {
  font-size: 14px;
  color: var(--ink-2);
  overflow-wrap: anywhere;

  .mono { font-size: 13px; }
}

.op-note { font-size: 13px; }

.kv dd .muted {
  font-family: var(--body);
  font-size: 13px;
  margin-left: 6px;
}

.hint { margin-top: 32px; }
</style>
