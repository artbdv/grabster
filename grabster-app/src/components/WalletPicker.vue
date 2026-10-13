<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { fulfillBulkConnect } from '../lib/bulk-run'
import { short } from '../lib/mock'
import { WALLET_META, type WalletName, wallet } from '../lib/wallet'
import { useAuthStore, useStateStore, useUiStore, useWalletStore } from '../stores'

const ui = useUiStore()
const wallets = useWalletStore()
const flow = useStateStore()
const auth = useAuthStore()
const otherInList = computed(() =>
  Boolean(
    wallets.after === 'bulk'
    && wallet.publicKey
    && flow.bulkAccept.includes(wallet.publicKey)
    && wallet.publicKey !== wallets.expectAddr,
  ),
)
const bulkNeed = computed(() => wallets.after === 'bulk' && Boolean(wallets.expectAddr))
/** A specific account must sign: the next list wallet, or the checked wallet of a single reclaim. */
const needAddr = computed(() => (wallets.after === 'bulk' || wallets.after === 'claim') && Boolean(wallets.expectAddr))
const options: WalletName[] = ['Phantom', 'Solflare', 'WalletConnect']
const connected = computed(() => Boolean(wallet.publicKey))
const meta = computed(() => (wallet.name ? WALLET_META[wallet.name] : null))
function tile(name: WalletName) { return WALLET_META[name] }
/** The wallet glyphs are single-colour SVGs; drawn as a mask so they take the ink colour of the theme. */
function glyph(src: string) { return { '--glyph': `url("${src}")` } }

async function pick(name: WalletName) {
  try {
    await wallets.pick(name)
  } catch (e) {
    if (e instanceof Error && e.message === 'cancelled') return
    ui.showToast('Could not connect that wallet.')
  }
}

async function disconnect() {
  if (wallets.after === 'session' || wallets.after === 'login') {
    await auth.logout()
    wallets.close()
    return
  }
  await wallets.drop()
}

async function copyAddr() {
  if (!wallet.publicKey) return
  try { await navigator.clipboard.writeText(wallet.publicKey) } catch { /* ignore */ }
  ui.showToast('Address copied')
}

async function signIn() {
  try {
    await auth.loginWithConnectedWallet()
    if (wallets.after === 'claim-login') {
      wallets.close()
      flow.openClaim()
      return
    }
    wallets.close()
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : 'Could not sign in.')
  }
}

function useBulk() {
  wallets.close()
  fulfillBulkConnect()
}

function onBackdrop() {
  if (!wallet.connecting) wallets.close()
}

function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape' && !wallet.connecting) wallets.close()
}

onMounted(() => document.addEventListener('keydown', onEsc))
onUnmounted(() => document.removeEventListener('keydown', onEsc))
</script>

<template>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="walletTitle" @click.self="onBackdrop">
    <div class="card wallet-card">
      <h2 id="walletTitle">{{
        bulkNeed ? 'Connect this address'
          : wallets.after === 'claim-login' ? 'Sign in for Grabster balance'
          : connected ? 'Your wallet'
            : auth.address ? 'Connect to sign'
              : 'Connect'
      }}</h2>
      <p v-if="wallets.after === 'claim-login' && !auth.address" class="muted expect">
        Grabster balance belongs to the wallet you sign in with. Connect that wallet first — credits from this cleanup go to its balance.
      </p>
      <p v-if="!connected && auth.address && !bulkNeed" class="muted expect">
        Signed in as {{ short(auth.address) }}. Connect that same wallet when you need to sign.
      </p>
      <template v-if="needAddr">
        <p class="expect-addr">{{ wallets.expectAddr }}</p>
        <p class="muted expect">
          Open Phantom or Solflare. In the wallet, switch to the account that matches this address. Then pick that wallet below.
        </p>
      </template>

      <div class="wallet-body">
        <div v-if="connected && meta" class="wallet-connected">
          <div class="wallet-now">
            <span class="glyph wallet-now-icon" aria-hidden="true" :style="glyph(meta.icon)"></span>
            <div class="wallet-now-copy">
              <b>{{ meta.label }}</b>
              <button class="wallet-chip" type="button" title="Copy address" @click="copyAddr">
                {{ short(wallet.publicKey) }}
              </button>
            </div>
            <button class="btn btn-ghost btn-sm" type="button" @click="disconnect">Disconnect</button>
          </div>
          <p v-if="needAddr && wallet.publicKey !== wallets.expectAddr && !otherInList" class="muted expect">
            That’s a different account. In {{ meta.label }}, switch to the address above, disconnect here, then connect again.
          </p>
          <p v-else-if="otherInList" class="muted expect">
            This account is also in your cleanup list. You can close it first.
          </p>
          <button
            v-if="wallets.after === 'bulk' && wallets.expectAddr && wallet.publicKey === wallets.expectAddr"
            class="btn btn-md arrow"
            type="button"
            @click="useBulk"
          >Use this wallet</button>
          <button v-else-if="otherInList" class="btn btn-md arrow" type="button" @click="useBulk">Close this one first</button>
          <button v-else-if="wallets.after === 'login' || wallets.after === 'claim-login'" class="btn btn-md arrow" type="button" :disabled="auth.busy" @click="signIn">Connect wallet</button>
        </div>

        <div v-else class="wallet-grid">
          <button
            v-for="name in options"
            :key="name"
            class="wallet-tile"
            type="button"
            :disabled="wallet.connecting"
            @click="pick(name)"
          >
            <span class="glyph" aria-hidden="true" :style="glyph(tile(name).icon)"></span>
            <span>{{ tile(name).label }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.wallet-card { max-width: 560px; }

.expect-addr {
  margin: 14px 0 0;
  padding: 14px 16px;
  border: 1px solid var(--line-3);
  background: var(--surface);
  font-family: var(--mono);
  font-size: 14px;
  overflow-wrap: anywhere;
}

.expect {
  margin: 12px 0 0;
  font-size: 15px;
}

/* The body runs to the card edges: wallet cells butt against the frame. */
.wallet-body {
  margin: 28px calc(-1 * var(--pad)) calc(-1 * var(--pad));
  border-top: 1px solid var(--ink);
}

.wallet-connected {
  display: grid;
  gap: 0;
  width: 100%;

  > .expect { margin: 0; padding: 16px var(--pad) 0; }

  > .btn {
    margin: 16px var(--pad) var(--pad);
    min-height: 56px;
    font-size: 17px;
  }

  > .btn.arrow::after { width: 56px; }
}

.wallet-now {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  padding: 18px var(--pad);
  border-bottom: 1px solid var(--line-2);
  background: var(--surface);
  width: 100%;

  @media (max-width: 520px) {
    grid-template-columns: 36px minmax(0, 1fr);

    .btn { grid-column: 1 / -1; }
  }
}

.glyph {
  display: block;
  flex: none;
  background: currentColor;
  -webkit-mask: var(--glyph) center / contain no-repeat;
  mask: var(--glyph) center / contain no-repeat;
}

.wallet-now-icon {
  width: 40px;
  height: 40px;
  color: var(--ink);
}

.wallet-now-copy {
  min-width: 0;

  b {
    display: block;
    font-family: var(--display);
    font-weight: 600;
    font-size: 20px;
    letter-spacing: -0.02em;
  }
}

.wallet-chip {
  margin-top: 4px;
  padding: 0;
  border: 0;
  background: none;
  font-family: var(--mono);
  font-size: 13px;
  color: var(--ink-2);
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: var(--line-3);
  text-underline-offset: 3px;
  transition: color 0.15s;

  &:hover { color: var(--accent-text); }
}

/* Wallets: three cells on rules; hover fills purple. */
.wallet-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  width: 100%;

  @media (max-width: 520px) {
    grid-template-columns: minmax(0, 1fr);
  }
}

.wallet-tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  gap: 28px;
  min-height: 168px;
  padding: 20px var(--pad) 20px;
  border: 0;
  border-right: 1px solid var(--line-2);
  border-radius: 0;
  background: transparent;
  color: var(--ink);
  cursor: pointer;
  text-align: left;
  min-width: 0;
  transition: background 0.15s, color 0.15s;

  &:last-child { border-right: 0; }

  &:hover { background: var(--accent); color: var(--accent-ink); }
  &:focus-visible { outline-offset: -3px; }
  &:disabled { color: var(--muted); cursor: not-allowed; }
  &:disabled:hover { background: transparent; color: var(--muted); }

  .glyph {
    width: 44px;
    height: 44px;
  }

  span {
    font-family: var(--display);
    font-weight: 600;
    font-size: 20px;
    letter-spacing: -0.02em;
  }

  @media (max-width: 520px) {
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    gap: 16px;
    min-height: 72px;
    padding: 14px var(--pad);
    border-right: 0;
    border-bottom: 1px solid var(--line-2);

    &:last-child { border-bottom: 0; }

    .glyph {
      width: 32px;
      height: 32px;
    }
  }
}
</style>
