<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Bucks from '../../components/Bucks.vue'
import { fetchRefLeaders, fetchRefMe, type RefLeaders, type RefMine } from '../../lib/api'
import { fmt, short } from '../../lib/mock'
import { useAuthStore, useStateStore, useUiStore } from '../../stores'

/** The API returns at most this many invited wallets, newest first (grabster-api/src/shared/referral.ts). */
const GUEST_LIMIT = 40

const ui = useUiStore()
const auth = useAuthStore()
const flow = useStateStore()
const mine = ref<RefMine | null>(null)
const share = computed(() => mine.value?.share ?? flow.cfg.refShare)
const mineErr = ref('')
const loading = ref(false)
const board = ref<RefLeaders>({ rows: [], you: null })
const boardErr = ref('')

const link = computed(() => (mine.value ? `${location.origin}/r/${mine.value.code}` : ''))

watch(() => auth.address, () => { void load() }, { immediate: true })

async function load() {
  mineErr.value = ''
  if (!auth.address) {
    mine.value = null
    loading.value = false
  } else {
    loading.value = true
    try {
      mine.value = await fetchRefMe()
    } catch (e) {
      mine.value = null
      mineErr.value = e instanceof Error ? e.message : 'Could not load your link.'
    } finally {
      loading.value = false
    }
  }
  boardErr.value = ''
  try {
    board.value = await fetchRefLeaders()
  } catch (e) {
    board.value = { rows: [], you: null }
    boardErr.value = e instanceof Error ? e.message : 'Could not load the table.'
  }
}

function copy() {
  if (!link.value) return
  try { void navigator.clipboard?.writeText(link.value) } catch { /* clipboard may be unavailable */ }
  ui.showToast('Link copied')
}
</script>

<template>
  <div class="pane">
    <section class="page-section" aria-labelledby="ref-title">
      <p class="kicker"><span>01</span>Referral link</p>
      <div class="split">
        <div>
          <h2 id="ref-title">Share a link, get part of the fee.</h2>
          <p class="muted intro">
            When a wallet that opened your link cleans up on this website, {{ share }}% of the Grabster fee Grabster
            actually receives from that cleanup is credited to your Grabster balance.
          </p>
          <dl class="kv rules">
            <div><dt>Counts</dt><dd>Cleanups on this website</dd></div>
            <div><dt>Does not count</dt><dd>API, MCP and local-file operations</dd></div>
            <div><dt>Your share</dt><dd>{{ share }}% of the Grabster fee received</dd></div>
            <div><dt>Link memory</dt><dd>30 days in the visitor’s browser</dd></div>
            <div><dt>Linked wallet</dt><dd>Stays with the first referrer it cleaned up with</dd></div>
            <div><dt>Paid to</dt><dd>Your Grabster balance</dd></div>
            <div><dt>Past earnings</dt><dd>Stay in your balance</dd></div>
          </dl>
        </div>

        <div class="mine">
          <template v-if="mine">
            <label class="field-label" for="ref-link">Your link</label>
            <div class="linkrow">
              <input id="ref-link" class="input" readonly spellcheck="false" :value="link" @focus="($event.target as HTMLInputElement).select()" />
              <button class="btn btn-sm" type="button" aria-label="Copy referral link" @click="copy">Copy</button>
            </div>
            <div class="stats-row">
              <div><b>{{ mine.invited }}</b><small>Linked wallets</small></div>
              <div><b>{{ mine.wallets }}</b><small>Earning wallets</small></div>
              <div><b>{{ fmt(mine.earnedSol) }}</b><small>Earned · SOL<Bucks :sol="mine.earnedSol" paren /></small></div>
              <div><b>{{ fmt(mine.pendingSol) }}</b><small>Pending · SOL<Bucks :sol="mine.pendingSol" paren /></small></div>
            </div>
            <p class="hint">
              A wallet is linked when it cleans up on this site with your link. It counts as earning once one of its
              cleanups credits you. Withdraw earnings from <router-link class="link" to="/profile/balance">Balance</router-link>.
            </p>
          </template>
          <div v-else aria-live="polite">
            <p v-if="loading" class="muted">Loading your link…</p>
            <template v-else-if="mineErr">
              <p class="err">{{ mineErr }}</p>
              <button class="btn btn-sm btn-ghost retry" type="button" @click="load">Try again</button>
            </template>
          </div>
        </div>
      </div>
    </section>

    <section v-if="mine && mine.guests?.length" class="page-section" aria-labelledby="guests-title">
      <p class="kicker"><span>02</span>Linked wallets</p>
      <h2 id="guests-title" class="sr-only">Wallets linked to your referral link</h2>
      <div class="tscroll">
        <table class="table">
          <thead><tr><th scope="col">Wallet</th><th scope="col">Status</th></tr></thead>
          <tbody>
            <tr v-for="g in mine.guests" :key="g.addr">
              <td class="mono">{{ short(g.addr) }}</td>
              <td><span class="status" :data-s="g.cleaned ? 'ok' : 'none'">{{ g.cleaned ? 'Earning' : 'Linked, no credit yet' }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="mine.guests.length >= GUEST_LIMIT" class="hint">Showing the latest {{ GUEST_LIMIT }}.</p>
    </section>

    <section class="page-section" aria-labelledby="board-title">
      <p class="kicker"><span>{{ mine && mine.guests?.length ? '03' : '02' }}</span>Top referrers</p>
      <h2 id="board-title" class="sr-only">Top referrers</h2>
      <div class="tscroll">
        <table class="table">
          <thead>
            <tr><th scope="col">#</th><th scope="col">Referrer</th><th scope="col" class="num">Earning wallets</th><th scope="col" class="num">Earned</th></tr>
          </thead>
          <tbody>
            <tr v-if="boardErr"><td colspan="4" class="muted">{{ boardErr }}</td></tr>
            <tr v-else-if="!board.rows.length"><td colspan="4" class="muted">No referral earnings yet.</td></tr>
            <tr v-for="(r, i) in board.rows" :key="r.addr" :class="{ you: mine && r.addr === mine.address }">
              <td class="mono">{{ String(i + 1).padStart(2, '0') }}</td>
              <td class="mono">{{ short(r.addr) }} <span v-if="mine && r.addr === mine.address" class="badge accent">you</span></td>
              <td class="num">{{ r.wallets }}</td>
              <td class="num amt">{{ fmt(r.earned) }} SOL</td>
            </tr>
            <tr v-if="mine && !board.rows.some((r) => r.addr === mine?.address)" class="you">
              <td class="mono">—</td>
              <td class="mono">{{ short(mine.address) }} <span class="badge accent">you</span></td>
              <td class="num">{{ mine.wallets }}</td>
              <td class="num amt">{{ fmt(mine.earnedSol) }} SOL</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="hint">Earned counts referral shares already available in each referrer’s Grabster balance.</p>
    </section>
  </div>
</template>

<style scoped lang="scss">
h2 { max-width: 14ch; }

.intro {
  margin-top: 24px;
  font-size: 16px;
  color: var(--ink-2);
  max-width: 54ch;
}

.rules {
  margin-top: 32px;

  dd { font-family: var(--body); font-size: 15px; color: var(--ink); letter-spacing: -0.01em; }
}

.mine { min-width: 0; }

/* Link field and Copy butt together. */
.linkrow {
  display: flex;
  align-items: stretch;
  min-width: 0;
  margin-bottom: 32px;

  .input { flex: 1; min-width: 0; }
  .btn { flex: none; min-height: 52px; min-width: 88px; justify-content: center; margin-left: -1px; }
}

.stats-row {
  grid-template-columns: repeat(2, minmax(0, 1fr));

  small :deep(.bucks) {
    font-family: var(--body);
    letter-spacing: 0;
    text-transform: none;
  }
}

.retry { margin-top: 12px; }

.table {
  .you td { background: var(--accent-soft); }

  .badge { margin-left: 6px; }
}
</style>
