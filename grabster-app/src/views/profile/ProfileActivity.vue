<script setup lang="ts">
import { ref, watch } from 'vue'
import Icon from '../../components/Icon.vue'
import { fmt, short, solscanTx } from '../../lib/mock'
import { loadBook } from '../../lib/siws'
import type { BalanceBook, LedgerLine } from '../../lib/api'
import { useAuthStore } from '../../stores'

/** The API returns at most this many ledger rows, newest first (grabster-api/src/shared/ledger.ts). */
const ROW_LIMIT = 80

const auth = useAuthStore()
const book = ref<BalanceBook | null>(null)
const err = ref('')
const loading = ref(false)

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

watch(() => auth.address, () => { void refresh() }, { immediate: true })

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
    err.value = e instanceof Error ? e.message : 'Could not load the history.'
  } finally {
    loading.value = false
  }
}

function typeLabel(row: LedgerLine) {
  if (row.kind === 'withdraw') return 'Withdraw'
  if (row.kind === 'referral') return 'Referral'
  return 'Credit'
}

function detail(row: LedgerLine) {
  if (row.kind === 'withdraw') return `To ${short(auth.address)}`
  return row.note
}

function status(row: LedgerLine): { s: string; label: string } {
  if (row.status === 'failed') return { s: 'bad', label: 'Failed' }
  if (row.kind === 'withdraw') return row.status === 'pending' ? { s: 'wait', label: 'Sending' } : { s: 'ok', label: 'Sent' }
  if (row.status === 'available') return { s: 'ok', label: 'Available' }
  if (row.status === 'pending') return { s: 'wait', label: 'In transit' }
  return { s: 'none', label: row.status }
}

function date(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : when.format(d)
}
</script>

<template>
  <div class="pane">
    <section class="page-section" aria-labelledby="act-title">
      <div class="kicker-row">
        <p class="kicker"><span>01</span>Activity</p>
        <button class="icon-btn" type="button" aria-label="Refresh activity" :disabled="loading" @click="refresh">
          <Icon name="refresh" small />
        </button>
      </div>
      <h2 id="act-title" class="sr-only">Grabster balance activity</h2>
      <p class="muted intro">
        Credits to your Grabster balance, referral shares and withdrawals, newest first. A credit becomes available once
        its transactions confirm on Solana.
      </p>

      <p v-if="loading && !book" class="muted state" aria-live="polite">Loading your history…</p>
      <template v-else-if="err && !book">
        <p class="err" aria-live="polite">{{ err }}</p>
        <button class="btn btn-sm btn-ghost retry" type="button" @click="refresh">Try again</button>
      </template>

      <template v-else-if="book">
        <p v-if="!book.rows.length" class="empty">
          Nothing here yet. Cleanups you send to Grabster balance, referral shares and withdrawals will show up here.
        </p>
        <div v-else class="tscroll" tabindex="0" aria-label="Activity table">
          <table class="table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Type</th>
                <th scope="col" class="num">Amount</th>
                <th scope="col">Status</th>
                <th scope="col">Transaction</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in book.rows" :key="row.id">
                <td class="mono date"><time :datetime="row.createdAt">{{ date(row.createdAt) }}</time></td>
                <td class="type">
                  <span>{{ typeLabel(row) }}</span>
                  <small v-if="detail(row)">{{ detail(row) }}</small>
                </td>
                <td class="num amt" :class="{ out: row.kind === 'withdraw' }">{{ row.kind === 'withdraw' ? '−' : '+' }}{{ fmt(row.sol) }} SOL</td>
                <td><span class="status" :data-s="status(row).s">{{ status(row).label }}</span></td>
                <td class="mono">
                  <template v-if="row.signatures[0]">
                    <a class="link" :href="solscanTx(row.signatures[0])" target="_blank" rel="noopener noreferrer" :aria-label="`View transaction ${short(row.signatures[0])} on Solscan`">{{ short(row.signatures[0]) }}</a>
                    <span v-if="row.signatures.length > 1" class="muted more">+{{ row.signatures.length - 1 }}</span>
                  </template>
                  <span v-else class="muted">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="book.rows.length >= ROW_LIMIT" class="hint">Showing the latest {{ ROW_LIMIT }} entries.</p>
        <p v-if="err" class="err" aria-live="polite">{{ err }}</p>
      </template>
    </section>
  </div>
</template>

<style scoped lang="scss">
.intro {
  max-width: 62ch;
  font-size: 16px;
  color: var(--ink-2);
  margin-bottom: 32px;
}

.retry { margin-top: 12px; }

.empty {
  padding: 32px 0;
  border-top: 1px solid var(--line-2);
  border-bottom: 1px solid var(--line-2);
  color: var(--ink-2);
  font-size: 17px;
}

.tscroll {
  &:focus-visible { outline-offset: 2px; }
}

.table {
  td.date { color: var(--ink-2); font-size: 13px; }

  .type {
    min-width: 180px;

    span { display: block; font-weight: 500; }

    small {
      display: block;
      margin-top: 2px;
      color: var(--muted);
      font-size: 13px;
    }
  }

  /* Credits are found SOL: the purple accent. Withdrawals stay neutral. */
  .amt { color: var(--accent-text); }
  .amt.out { color: var(--ink-2); }

  .more { margin-left: 6px; font-size: 12px; }
}
</style>
