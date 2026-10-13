<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fmtBalance, fullSol } from '../lib/sol-format'
import { short } from '../lib/mock'
import Icon from './Icon.vue'
import SolIcon from './SolIcon.vue'
import ThemeToggle from './ThemeToggle.vue'
import { useAuthStore, useBalanceStore, useStateStore, useUiStore, useWalletStore } from '../stores'

const route = useRoute()
const router = useRouter()
const flow = useStateStore()
const ui = useUiStore()
const auth = useAuthStore()
const balance = useBalanceStore()
const wallets = useWalletStore()

const MENU = [
  { path: '/cleanup', label: 'Cleanup' },
  { path: '/api', label: 'API' },
  { path: '/mcp', label: 'MCP' },
  { path: '/local', label: 'Local file' },
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/profile', label: 'Profile' },
]

/** Wallets the picker offers; their logos take turns in the button's right cell. */
const LOGOS = ['/wallets/phantom.svg', '/wallets/solflare.svg', '/wallets/walletconnect.svg']

const open = ref(false)
const root = ref<HTMLElement | null>(null)

function close() { open.value = false }
function onDoc(e: MouseEvent) { if (!root.value?.contains(e.target as Node)) close() }
function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') close() }

onMounted(() => {
  document.addEventListener('click', onDoc)
  document.addEventListener('keydown', onEsc)
})
onUnmounted(() => {
  document.removeEventListener('click', onDoc)
  document.removeEventListener('keydown', onEsc)
})
watch(() => route.fullPath, close)

/** Leaving a running cleanup asks first; everything else is a plain link. */
function leaveTo(path: string) {
  close()
  if (route.path === path) return
  const next = () => { void router.push(path) }
  if (flow.shouldWarnLeave) ui.askLeave(next)
  else next()
}

function home() {
  close()
  flow.goHome()
}

function openWallet() {
  close()
  wallets.open('session')
}

async function logout() {
  close()
  await auth.logout()
}

const active = (p: string) => (p === '/cleanup' ? route.path === '/cleanup' || route.path.startsWith('/check/') : route.path.startsWith(p))
</script>

<template>
  <header ref="root" class="nav">
    <a class="brand" href="/" aria-label="Grabster — home" @click.prevent="home">
      <span class="word">Grabster</span>
    </a>

    <div class="end">
      <ThemeToggle />
      <button
        class="menu-btn"
        type="button"
        aria-label="Menu"
        :aria-expanded="open"
        aria-controls="site-menu"
        @click="open = !open"
      >
        <span class="menu-label" aria-hidden="true">Menu</span>
        <span class="menu-cell" aria-hidden="true"><span class="bars" :class="{ x: open }"><i></i><i></i></span></span>
      </button>
      <!--
        Signed in: the Grabster balance (same source as Profile → Balance) leads to /profile/balance; the address is secondary.
        A failed load offers a retry instead of showing 0. Signed out: the wallet picker (Phantom, Solflare, WalletConnect).
      -->
      <template v-if="auth.address">
        <button
          v-if="balance.err && balance.availableSol === null"
          class="btn btn-ghost wallet-btn bal-btn"
          type="button"
          :title="balance.err"
          :disabled="balance.loading"
          @click="balance.refresh()"
        >
          <span class="bal"><small>Grabster balance</small><b>{{ balance.loading ? 'Loading…' : 'Couldn’t load · Retry' }}</b></span>
        </button>
        <a
          v-else
          class="btn wallet-btn bal-btn"
          href="/profile/balance"
          :title="balance.availableSol !== null ? `Grabster balance: ${fullSol(balance.availableSol)} · ${auth.address}` : auth.address"
          :aria-busy="balance.availableSol === null ? 'true' : undefined"
          @click.prevent="leaveTo('/profile/balance')"
        >
          <span class="bal">
            <small>Grabster balance</small>
            <b v-if="balance.availableSol !== null" class="bal-n">{{ fmtBalance(balance.availableSol) }}<SolIcon :size="13" /></b>
            <b v-else class="bal-load" aria-label="Loading balance"><i></i></b>
          </span>
          <span class="bal-who mono">{{ short(auth.address) }}</span>
        </a>
        <button class="sess-btn" type="button" title="Switch wallet" aria-label="Switch wallet" @click="openWallet">
          <Icon name="wallet" small />
        </button>
        <button class="sess-btn" type="button" title="Log out" aria-label="Log out" :disabled="auth.busy" @click="logout">
          <Icon name="logout" small />
        </button>
      </template>
      <button v-else class="btn wallet-btn" type="button" :disabled="auth.busy" @click="auth.login()">
        <span class="wb-label">Connect wallet</span>
        <span class="wb-logos" aria-hidden="true">
          <span v-for="(src, i) in LOGOS" :key="src" class="wb-logo" :style="{ '--glyph': `url('${src}')`, '--i': i }"></span>
        </span>
      </button>
    </div>

    <nav v-if="open" id="site-menu" class="menu" aria-label="Main">
      <a
        v-for="(m, i) in MENU"
        :key="m.path"
        :href="m.path"
        :class="{ on: active(m.path) }"
        :aria-current="active(m.path) ? 'page' : undefined"
        @click.prevent="leaveTo(m.path)"
      >
        <span class="idx">0{{ i + 1 }}</span>
        <span class="lbl">{{ m.label }}</span>
        <span class="arr" aria-hidden="true">→</span>
      </a>
    </nav>
  </header>
</template>

<style scoped lang="scss">
.nav {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 64px;
  padding: 0 var(--gutter);
  background: var(--bg);
  border-bottom: 1px solid var(--line-2);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--ink);
  text-decoration: none;

  .word {
    font-weight: 700;
    font-size: 26px;
    letter-spacing: -0.045em;
    line-height: 1;
    font-stretch: 82%;

    @media (max-width: 480px) { font-size: 22px; }
  }
}

.end {
  display: flex;
  align-items: stretch;
  gap: 8px;
  height: 40px;
}

.sess-btn {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid var(--line-3);
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);
  }

  &:disabled { opacity: 0.5; cursor: default; }

  @media (max-width: 420px) { width: 36px; }
}

.menu-btn {
  display: flex;
  align-items: stretch;
  padding: 0;
  border: 1px solid var(--line-3);
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;
  font-weight: 500;
  font-size: 16px;

  .menu-label {
    display: flex;
    align-items: center;
    padding: 0 16px;
    min-width: 120px;

    @media (max-width: 560px) { min-width: 0; padding: 0 12px; }
    @media (max-width: 480px) { display: none; }
  }

  .menu-cell {
    display: grid;
    place-items: center;
    width: 52px;
    border-left: 1px solid var(--line-3);

    @media (max-width: 480px) { border-left: 0; width: 44px; }
  }

  &:hover,
  &[aria-expanded='true'] {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);

    .menu-cell { border-color: var(--accent-ink); }
  }
}

.bars {
  display: grid;
  gap: 5px;
  width: 20px;

  i {
    display: block;
    height: 1.5px;
    background: currentColor;
    transition: transform 0.2s;
  }

  &.x i:first-child { transform: translateY(3.25px) rotate(45deg); }
  &.x i:last-child { transform: translateY(-3.25px) rotate(-45deg); }
}

.wallet-btn {
  min-height: 40px;
  padding-top: 0;
  padding-bottom: 0;

  &.arrow::after { margin-top: 0; margin-bottom: 0; }

}

/* Signed in: "Grabster balance" over the amount, the short address in its own cell. */
.bal-btn {
  padding-right: 0;
  align-items: stretch;
  text-align: left;

  .bal {
    display: flex;
    flex-direction: column;
    justify-content: center;
    line-height: 1.05;

    small { font-size: 10.5px; font-weight: 400; opacity: 0.75; letter-spacing: 0.01em; }
    b { font-size: 14.5px; font-weight: 600; white-space: nowrap; }

    .bal-n {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-variant-numeric: tabular-nums;
    }
  }

  .bal-who {
    display: flex;
    align-items: center;
    margin-left: 14px;
    padding: 0 12px;
    border-left: 1px solid currentColor;
    font-size: 12.5px;
    opacity: 0.8;

    @media (max-width: 560px) { display: none; }
  }

  &.btn-ghost { padding-right: 16px; }

  @media (max-width: 560px) { padding-right: 14px; }
}

.bal-load {
  display: block;
  position: relative;
  width: 64px;
  height: 3px;
  margin: 6px 0 3px;
  overflow: hidden;
  background: color-mix(in srgb, currentColor 25%, transparent);

  i {
    position: absolute;
    inset: 0 auto 0 0;
    width: 40%;
    background: currentColor;
    animation: bal-slide 0.9s ease-in-out infinite;
  }
}

@keyframes bal-slide {
  from { transform: translateX(-100%); }
  to { transform: translateX(250%); }
}

/* Connect wallet: label | a narrow cell where the wallet logos take turns. */
button.wallet-btn {
  padding-right: 0;
  align-items: stretch;

  .wb-label { display: flex; align-items: center; }

  .wb-logos {
    position: relative;
    width: 44px;
    margin-left: 16px;
    border-left: 1px solid currentColor;
  }

  .wb-logo {
    position: absolute;
    inset: 0;
    margin: auto;
    width: 20px;
    height: 20px;
    background: currentColor;
    -webkit-mask: var(--glyph) center / contain no-repeat;
    mask: var(--glyph) center / contain no-repeat;
    opacity: 0;
    animation: wallet-turn 6s infinite;
    animation-delay: calc(var(--i) * 2s);
  }

  /* Reduced motion: no turning, just the first logo. */
  .wb-logo:first-child { opacity: 1; }

  @media (max-width: 420px) {
    font-size: 14px;
    padding-left: 10px;

    .wb-logos { width: 36px; margin-left: 10px; }
  }
}

@keyframes wallet-turn {
  0% { opacity: 0; transform: translateY(6px); }
  6%, 30% { opacity: 1; transform: none; }
  36%, 100% { opacity: 0; transform: translateY(-6px); }
}

.menu {
  position: absolute;
  top: 100%;
  right: var(--gutter);
  width: min(520px, calc(100vw - 2 * var(--gutter)));
  background: var(--bg);
  border: 1px solid var(--line-3);
  border-top: 0;
  display: grid;

  a {
    display: grid;
    grid-template-columns: 52px 1fr 52px;
    align-items: stretch;
    min-height: 68px;
    border-top: 1px solid var(--line-2);
    color: var(--ink);
    text-decoration: none;
    transition: background 0.15s, color 0.15s;

    &:first-child { border-top: 1px solid var(--ink); }

    > span { display: flex; align-items: center; }

    .idx {
      justify-content: center;
      font-family: var(--mono);
      font-size: 12px;
      color: var(--muted);
      border-right: 1px solid var(--line-2);
    }

    .lbl {
      flex-direction: column;
      align-items: flex-start;
      justify-content: center;
      padding: 0 16px;
      font-size: 24px;
      font-weight: 600;
      letter-spacing: -0.03em;
      line-height: 1.05;

      small {
        font-size: 13px;
        font-weight: 400;
        letter-spacing: 0;
        color: var(--muted);
        margin-top: 2px;
      }
    }

    .arr {
      justify-content: center;
      border-left: 1px solid var(--line-2);
      font-family: var(--mono);
    }

    &:hover,
    &.on {
      background: var(--accent);
      color: var(--accent-ink);

      .idx, .lbl small { color: var(--accent-ink); }
      .idx, .arr { border-color: rgba(255, 255, 255, 0.4); }
    }
  }
}
</style>
