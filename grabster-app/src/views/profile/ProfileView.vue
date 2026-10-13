<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { SHOW_REFERRALS } from '../../lib/features'
import { useAuthStore, useStateStore, useUiStore } from '../../stores'

const route = useRoute()
const auth = useAuthStore()
const flow = useStateStore()
const ui = useUiStore()

/** Every profile tab, with the one-line public explanation shown before sign-in. */
const sections = computed(() => {
  const cfg = flow.cfg
  return [
    {
      name: 'profile',
      to: '/profile',
      label: 'Overview',
      blurb: 'The SOL on your wallet and the SOL Grabster holds for it, shown separately.',
      on: true,
    },
    {
      name: 'profile-balance',
      to: '/profile/balance',
      label: 'Balance',
      blurb: 'SOL credited to your Grabster balance by cleanups. Withdraw it to the wallet you signed in with.',
      on: cfg.features.balance,
    },
    {
      name: 'profile-activity',
      to: '/profile/activity',
      label: 'Activity',
      blurb: SHOW_REFERRALS
        ? 'Credits, referral shares and withdrawals, with status and Solana transaction links.'
        : 'Credits and withdrawals, with status and Solana transaction links.',
      on: cfg.features.balance,
    },
    {
      name: 'profile-key',
      to: '/profile/api-key',
      label: 'API key',
      blurb: `One key per wallet for the API and MCP. Free access: no subscription, no per-request charge. The Grabster fee (${cfg.feeDirect}% of recovered rent) is inside each plan.`,
      on: true,
    },
    {
      name: 'profile-referrals',
      to: '/profile/referrals',
      label: 'Referrals',
      blurb: `A link that credits you ${cfg.refShare}% of the Grabster fee from website cleanups by wallets that open it.`,
      on: cfg.features.referrals && SHOW_REFERRALS,
    },
  ]
})

const visible = computed(() => sections.value.filter((s) => s.on))
const current = computed(() => sections.value.find((s) => s.name === route.name) ?? sections.value[0])
const currentIndex = computed(() => String(Math.max(0, visible.value.indexOf(current.value)) + 1).padStart(2, '0'))

/** On narrow screens the tab strip scrolls; keep the active tab in view. */
const tabsEl = ref<HTMLElement | null>(null)

function showActiveTab() {
  const nav = tabsEl.value
  const active = nav?.querySelector<HTMLElement>('.router-link-exact-active')
  if (!nav || !active) return
  nav.scrollLeft = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2
}

onMounted(showActiveTab)
watch(() => route.name, () => { void nextTick(showActiveTab) })

function copyAddr() {
  if (!auth.address) return
  try { void navigator.clipboard?.writeText(auth.address) } catch { /* clipboard may be blocked */ }
  ui.showToast('Address copied')
}
</script>

<template>
  <section class="screen profile">
    <header class="page-head">
      <h1>Your account</h1>
      <div v-if="auth.address" class="who">
        <span class="label">Signed in as</span>
        <span class="mono addr">{{ auth.address }}</span>
        <button class="btn btn-sm btn-ghost" type="button" aria-label="Copy wallet address" @click="copyAddr">Copy</button>
      </div>
      <p v-else class="lede">Grabster balance, activity and API key for the wallet you sign in with.</p>
    </header>

    <div class="tabs-band">
      <nav ref="tabsEl" class="tabs" aria-label="Profile sections">
        <router-link v-for="s in visible" :key="s.name" :to="s.to">{{ s.label }}</router-link>
      </nav>
    </div>

    <div v-if="!auth.address && !auth.ready" class="page-section">
      <p class="muted" aria-live="polite">Checking your session…</p>
    </div>

    <div v-else-if="!auth.address" class="page-section gate">
      <p class="kicker"><span>{{ currentIndex }}</span>{{ current.label }}</p>
      <div class="split gate-grid">
        <div>
          <h2>Sign in with your wallet.</h2>
          <p class="lede">{{ current.blurb }}</p>
          <div class="cta">
            <button class="btn btn-lg arrow" type="button" :disabled="auth.busy" @click="auth.login()">Connect wallet</button>
          </div>
          <p class="hint">Signing in is one message signature. No transaction, no email, no password.</p>
        </div>
        <div>
          <p class="label">In your profile</p>
          <ul class="sections">
            <li v-for="s in visible" :key="s.name">
              <router-link :to="s.to">{{ s.label }}</router-link>
              <p>{{ s.blurb }}</p>
            </li>
          </ul>
          <p class="hint">
            The <router-link class="link" to="/api">API</router-link>,
            <router-link class="link" to="/mcp">MCP</router-link> and
            <router-link class="link" to="/local">local file</router-link> docs are public. No wallet needed to read them.
          </p>
        </div>
      </div>
    </div>

    <div v-else-if="!current.on" class="page-section">
      <p class="muted">{{ current.label }} is not available on this server right now.</p>
      <router-link class="btn btn-sm btn-ghost arrow back" to="/profile">Back to overview</router-link>
    </div>

    <router-view v-else />
  </section>
</template>

<!--
  Rhythm shared by the profile panes (Overview, Balance, Activity, API key). Unscoped on purpose:
  the panes render inside <router-view>, and these rules only tune the shared page scaffolding.
  --sec-gap is the space between a section label strip and its content.
-->
<style lang="scss">
.profile {
  --sec-gap: 24px;

  @media (max-width: 640px) { --sec-gap: 20px; }

  .page-section > :is(.kicker, .kicker-row) { margin-bottom: var(--sec-gap); }

  /* Columns under a label keep sharing its rule; their content starts one --sec-gap below it. */
  .page-section > :is(.kicker, .kicker-row) + .split,
  .page-section > :is(.kicker, .kicker-row) + .sr-only + .split {
    margin-top: calc(-1 * var(--sec-gap));

    > * { padding-top: var(--sec-gap); }
  }

  .page-section > :is(.kicker, .kicker-row) + .stats-row,
  .page-section > :is(.kicker, .kicker-row) + .split > * > .stats-row:first-child,
  .page-section > :is(.kicker, .kicker-row) + .sr-only + .split > * > .stats-row:first-child {
    margin-top: calc(-1 * var(--sec-gap));
  }
}
</style>

<style scoped lang="scss">
/* Tab strip: a band on the page rules; the framed control sits inside the gutter. */
.tabs-band {
  padding: 20px var(--gutter);
  border-bottom: 1px solid var(--line-2);
  min-width: 0;

  .tabs {
    width: fit-content;
    max-width: 100%;

    > a { min-height: 48px; padding: 0 22px; font-size: 16px; }
  }

  @media (max-width: 640px) {
    padding: 14px var(--gutter);

    .tabs {
      width: 100%;

      > a { flex: 1 1 auto; justify-content: center; padding: 0 12px; font-size: 15px; }
    }
  }
}

.who {
  display: flex;
  align-items: stretch;
  flex-wrap: wrap;
  margin-top: 32px;
  min-width: 0;
  max-width: 880px;

  .label {
    display: flex;
    align-items: center;
    padding: 0 14px;
    border: 1px solid var(--line-3);
    border-right: 0;
    background: var(--bg-2);
  }

  .addr {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
    padding: 10px 14px;
    border: 1px solid var(--line-3);
    background: var(--surface);
    font-size: 14px;
    color: var(--ink);
    overflow-wrap: anywhere;
  }

  .btn { margin-left: -1px; }

  @media (max-width: 560px) {
    .label { width: 100%; border-right: 1px solid var(--line-3); border-bottom: 0; padding: 8px 14px; }
  }
}

.back { margin-top: 20px; }

.gate-grid {
  h2 { max-width: 12ch; }

  .lede { margin-top: 24px; font-size: 18px; }
}

.cta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 36px;
  max-width: 480px;
}

/* What the profile holds: big rows on rules, each a link. */
.sections {
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
  border-top: 1px solid var(--line-2);

  li {
    padding: 18px 0;
    border-bottom: 1px solid var(--line-2);
    min-width: 0;
  }

  a {
    font-size: clamp(22px, 2.2vw, 30px);
    font-weight: 600;
    letter-spacing: -0.025em;
    line-height: 1.1;
    color: var(--ink);
    text-decoration: none;

    &::after { content: ' →'; font-family: var(--mono); font-size: 0.6em; font-weight: 400; vertical-align: 0.15em; }

    &:hover { color: var(--accent-text); }
  }

  p {
    margin-top: 6px;
    color: var(--ink-2);
    font-size: 15px;
  }
}
</style>
