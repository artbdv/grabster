<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Bucks from '../../components/Bucks.vue'
import Icon from '../../components/Icon.vue'
import { fetchBalance, type BalanceBook } from '../../lib/api'
import { fmt, short } from '../../lib/mock'
import { SHOW_REFERRALS } from '../../lib/features'
import { loadBook } from '../../lib/siws'
import { useAuthStore, useStateStore, useUiStore, useWalletStore } from '../../stores'

const router = useRouter()
const auth = useAuthStore()
const flow = useStateStore()
const ui = useUiStore()
const wallets = useWalletStore()
const features = computed(() => flow.cfg.features)

const walletSol = ref<number | null>(null)
const walletErr = ref('')
const walletBusy = ref(false)
const book = ref<BalanceBook | null>(null)
const bookErr = ref('')
const bookBusy = ref(false)
const leaving = ref(false)

const busy = computed(() => walletBusy.value || bookBusy.value)

watch(() => auth.address, () => { refresh() }, { immediate: true })

function refresh() {
  void loadWallet()
  if (features.value.balance) void loadGrabster()
}

/** Live on-chain SOL of the signed-in wallet. */
async function loadWallet() {
  const addr = auth.address
  walletErr.value = ''
  walletSol.value = null
  if (!addr) return
  walletBusy.value = true
  try {
    const res = await fetchBalance(addr)
    if (auth.address === addr) walletSol.value = res.sol
  } catch (e) {
    if (auth.address === addr) walletErr.value = e instanceof Error ? e.message : 'Could not read the wallet balance.'
  } finally {
    walletBusy.value = false
  }
}

/** SOL Grabster's ledger owes this wallet. */
async function loadGrabster() {
  const addr = auth.address
  bookErr.value = ''
  if (!addr) {
    book.value = null
    return
  }
  bookBusy.value = true
  try {
    const next = await loadBook()
    if (auth.address === addr) book.value = next
  } catch (e) {
    if (auth.address === addr) {
      book.value = null
      bookErr.value = e instanceof Error ? e.message : 'Could not load the Grabster balance.'
    }
  } finally {
    bookBusy.value = false
  }
}

async function logout() {
  leaving.value = true
  try {
    await auth.logout()
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : 'Could not log out.')
    leaving.value = false
    return
  }
  leaving.value = false
  void router.push({ name: 'home' })
}
</script>

<template>
  <div class="pane">
    <section class="page-section" aria-labelledby="ov-balances">
      <div class="kicker-row">
        <p class="kicker"><span>01</span>Balances</p>
        <button class="icon-btn" type="button" aria-label="Refresh balances" :disabled="busy" @click="refresh">
          <Icon name="refresh" small />
        </button>
      </div>
      <h2 id="ov-balances" class="sr-only">Balances</h2>

      <div class="split figures">
        <article aria-labelledby="ov-wallet">
          <p id="ov-wallet" class="label">Wallet SOL balance</p>
          <p class="fig" aria-live="polite">
            <template v-if="walletSol !== null">{{ fmt(walletSol) }} <span class="unit">SOL</span><Bucks :sol="walletSol" paren /></template>
            <span v-else-if="walletBusy" class="muted">Reading…</span>
            <span v-else class="muted">—</span>
          </p>
          <p class="desc">On-chain SOL in {{ short(auth.address) }}, read live from Solana. It stays in your wallet; Grabster does not hold it.</p>
          <p v-if="walletErr" class="err">{{ walletErr }}</p>
        </article>

        <article v-if="features.balance" aria-labelledby="ov-grabster">
          <p id="ov-grabster" class="label">Grabster balance</p>
          <p class="fig" aria-live="polite">
            <template v-if="book">{{ fmt(book.availableSol + book.pendingSol) }} <span class="unit">SOL</span><Bucks :sol="book.availableSol + book.pendingSol" paren /></template>
            <span v-else-if="bookBusy" class="muted">Loading…</span>
            <span v-else class="muted">—</span>
          </p>
          <p class="desc">Held by Grabster for this wallet, not in it. Available SOL can be withdrawn any time.</p>
          <dl v-if="book" class="kv">
            <div><dt>Available</dt><dd>{{ fmt(book.availableSol) }} SOL</dd></div>
            <div><dt>In transit</dt><dd>{{ fmt(book.pendingSol) }} SOL</dd></div>
          </dl>
          <p v-if="bookErr" class="err">{{ bookErr }}</p>
          <router-link class="btn btn-sm btn-ghost arrow withdraw" to="/profile/balance">Withdraw</router-link>
        </article>
      </div>

      <p class="hint">
        Grabster does not keep a per-wallet total of recovered SOL, so none is shown here.
        <template v-if="features.balance">The Grabster balance only counts cleanups already credited to it, not rent you have yet to reclaim.</template>
        Checking another address on Cleanup never changes whose profile this is.
      </p>
    </section>

    <section class="page-section" aria-labelledby="ov-go">
      <p class="kicker"><span>02</span>Sections</p>
      <h2 id="ov-go" class="sr-only">Profile sections</h2>
      <ul class="go">
        <li v-if="features.balance">
          <router-link to="/profile/balance"><span class="name">Balance</span><span class="what">Withdraw to {{ short(auth.address) }}</span></router-link>
        </li>
        <li v-if="features.balance">
          <router-link to="/profile/activity"><span class="name">Activity</span><span class="what">{{ SHOW_REFERRALS ? 'Credits, referral shares and withdrawals' : 'Credits and withdrawals' }}</span></router-link>
        </li>
        <li>
          <router-link to="/profile/api-key"><span class="name">API key</span><span class="what">One key for the API and MCP</span></router-link>
        </li>
        <li v-if="features.referrals && SHOW_REFERRALS">
          <router-link to="/profile/referrals"><span class="name">Referrals</span><span class="what">Your link and what it has earned</span></router-link>
        </li>
      </ul>
    </section>

    <section class="page-section" aria-labelledby="ov-session">
      <p class="kicker"><span>03</span>Session</p>
      <h2 id="ov-session" class="sr-only">Session</h2>
      <div class="session">
        <p class="session-copy">
          Signed in as <span class="mono">{{ short(auth.address) }}</span>. To use a different wallet, open the wallet dialog,
          disconnect, then sign in with the other one.
        </p>
        <div class="cta">
          <button class="btn btn-ghost" type="button" @click="wallets.open('session')">Switch wallet</button>
          <button class="btn btn-ghost" type="button" :disabled="leaving" @click="logout">{{ leaving ? 'Logging out…' : 'Log out' }}</button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
/* Two figures on a rule, under the section label. */
.figures {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-bottom: 1px solid var(--line-2);

  article {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-bottom: 40px;
  }

  .fig {
    font-family: var(--display);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    font-size: clamp(48px, 6vw, 96px);
    letter-spacing: -0.045em;
    line-height: 0.95;
    overflow-wrap: anywhere;
    margin-top: 8px;

    .unit { font-size: 0.36em; letter-spacing: -0.01em; color: var(--ink); }
    .muted { font-size: 18px; letter-spacing: 0; }

    :deep(.bucks) { font-size: 15px; letter-spacing: 0; }
  }

  .label { font-size: 16px; }

  .desc {
    color: var(--ink-2);
    font-size: 15px;
    max-width: 46ch;
  }

  .kv { margin-top: 8px; }

  .withdraw { align-self: flex-start; margin-top: 12px; }

  @media (max-width: 960px) {
    grid-template-columns: minmax(0, 1fr);
  }
}

.hint { margin-top: 24px; }

/*
 * Section links: each row is one link on full-width rules. Name, caption and arrow sit in the
 * same three columns on every row; the whole row is the hit area and fills purple on hover.
 */
.go {
  list-style: none;
  /* Starts on the label's rule, runs down to the section rule. */
  margin: calc(-1 * var(--sec-gap)) calc(-1 * var(--gutter)) -64px;
  padding: 0;

  li { min-width: 0; }
  li + li { border-top: 1px solid var(--line-2); }

  a {
    display: grid;
    grid-template-columns: minmax(180px, 5fr) minmax(0, 6fr) 24px;
    align-items: center;
    column-gap: var(--gutter);
    min-height: 88px;
    padding: 20px var(--gutter);
    color: var(--ink);
    text-decoration: none;
    transition: background 0.15s, color 0.15s;

    &::after {
      content: '→';
      justify-self: end;
      font-family: var(--mono);
      font-size: 18px;
    }

    &:hover {
      background: var(--accent);
      color: var(--accent-ink);

      .what { color: var(--accent-ink); }
    }

    &:focus-visible { outline-offset: -3px; }
  }

  .name {
    font-size: clamp(24px, 2.6vw, 40px);
    font-weight: 600;
    letter-spacing: -0.03em;
    line-height: 1.05;
  }

  .what {
    color: var(--ink-2);
    font-size: 16px;
    line-height: 1.35;
    transition: color 0.15s;
  }

  @media (max-width: 640px) {
    margin-bottom: -44px;

    a {
      grid-template-columns: minmax(0, 1fr) 24px;
      grid-template-rows: auto auto;
      row-gap: 6px;
      min-height: 0;
      padding-top: 18px;
      padding-bottom: 18px;
    }

    .name { grid-column: 1; }
    .what { grid-column: 1; grid-row: 2; }
    a::after { grid-column: 2; grid-row: 1 / span 2; }
  }
}

/* Session: the explanation on the left, the two actions in their own cell on the right. */
.session {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 24px 48px;
}

.session-copy {
  flex: 1 1 320px;
  max-width: 62ch;
  font-size: 16px;
  color: var(--ink-2);
}

.cta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  flex: none;

  .btn { min-height: 48px; }

  @media (max-width: 640px) {
    width: 100%;

    .btn { flex: 1 1 140px; justify-content: center; }
  }
}
</style>
