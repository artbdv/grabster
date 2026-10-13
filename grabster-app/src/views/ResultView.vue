<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Bucks from '../components/Bucks.vue'
import DestinationChoices from '../components/DestinationChoices.vue'
import { fmt, lamportsToSol, networkFeeSol, short, treasuryGasWithholdSol, withBucks } from '../lib/mock'
import type { TokenBox } from '@grabster/solana-core'
import { secretFor } from '../lib/secrets'
import { wallet } from '../lib/wallet'
import { useAuthStore, useStateStore, useUiStore, useWalletStore } from '../stores'

const router = useRouter()
const flow = useStateStore()
const ui = useUiStore()
const wallets = useWalletStore()
const auth = useAuthStore()

const e = computed(() => flow.est!)

/**
 * Can this page sign for the checked wallet right now? Decided by the signer, not by the Grabster sign-in:
 * a key in this tab, the matching wallet connected, a different wallet connected, or none.
 */
type SignerState = 'local' | 'ready' | 'mismatch' | 'none'
const signerState = computed<SignerState>(() => {
  if (flow.kind === 'key' || flow.kind === 'seed' || secretFor(flow.addr)) return 'local'
  if (!wallet.publicKey) return 'none'
  return wallet.publicKey === flow.requiredSigner ? 'ready' : 'mismatch'
})
const canSign = computed(() => signerState.value === 'local' || signerState.value === 'ready')
const ctaLabel = computed(() => {
  if (acting.value) return 'Preparing…'
  if (signerState.value === 'none') return 'Connect wallet to reclaim'
  if (signerState.value === 'mismatch') return 'Switch wallet to reclaim'
  return 'Reclaim SOL'
})
const acting = ref(false)

/** One press, one run: connect / switch opens the wallet dialog; a ready signer opens the exact plan. */
async function act() {
  if (acting.value || ui.claimOpen) return
  if (!canSign.value) {
    wallets.open('claim', flow.requiredSigner)
    return
  }
  acting.value = true
  try { await grab() } finally { acting.value = false }
}

function copy(text: string, what: string) {
  try { void navigator.clipboard?.writeText(text) } catch { /* clipboard may be blocked */ }
  ui.showToast(`${what} copied`)
}
const emptyBoxes = computed(() => flow.boxes.filter((b) => b.kind === 'empty'))
const showAccounts = ref(false)

async function grab() {
  if (flow.tot.boxes <= 0 && flow.refundAccounts.length <= 0) {
    flow.advanced = true
    ui.showToast('No empty accounts here. Choose an operation under Additional operations.', 3500)
    return
  }
  if (!flow.claimAllowed()) return
  if (!canSign.value) {
    wallets.open('claim', flow.requiredSigner)
    return
  }
  ctaErr.value = ''
  if (wallet.publicKey === flow.addr && !auth.address) {
    try { await auth.loginWithConnectedWallet() }
    catch (err) {
      // Cancelled or failed sign-in: the form stays as it is; the reason stays next to the button.
      ctaErr.value = err instanceof Error ? err.message : 'Could not sign in.'
      return
    }
  }
  flow.openClaim()
}
const ctaErr = ref('')

const shown = ref(0)
let countRaf = 0
function countUp(to: number) {
  if (countRaf) cancelAnimationFrame(countRaf)
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { shown.value = to; return }
  const t0 = performance.now(), dur = 600
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / dur)
    shown.value = to * (1 - Math.pow(1 - k, 3))
    if (k < 1) countRaf = requestAnimationFrame(step)
    else countRaf = 0
  }
  countRaf = requestAnimationFrame(step)
}
onMounted(() => countUp(flow.tot.net))
watch(() => flow.tot.net, (v) => {
  if (countRaf) { cancelAnimationFrame(countRaf); countRaf = 0 }
  shown.value = v
})
watch(() => flow.canGive, (ok) => { if (!ok && flow.dustMode === 'give') flow.dustMode = 'keep' })

function toggleAdvanced() {
  flow.advanced = !flow.advanced
  if (!flow.advanced) {
    flow.dustMode = 'keep'
    flow.nftOn = false
    flow.excessOn = false
  }
}

const covered = computed(() => Boolean(flow.cfg.treasuryPaysGas && e.value.noSol))
const gasSol = computed(() => networkFeeSol(flow.tot.boxes, flow.dest, flow.cfg, flow.feeSplit))
const gasWithhold = computed(() => treasuryGasWithholdSol(flow.tot.boxes, flow.cfg, covered.value, flow.feeSplit))
const otherKept = computed(() => e.value.dust + e.value.nft + e.value.keep)
const extraOn = computed(() => flow.dustMode !== 'keep' || flow.nftOn || flow.excessOn)

const recipient = computed(() => {
  if (flow.dest === 'balance') return 'Grabster balance (held by Grabster)'
  if (flow.dest === 'other') return flow.other ? short(flow.other) : 'Enter an address'
  return `This wallet · ${short(flow.addr)}`
})

function tokenAmt(b: TokenBox) {
  const n = Number(b.amount) / 10 ** Math.max(0, b.decimals)
  return fmt(n, Math.min(6, Math.max(0, b.decimals)))
}

function copyAddr() {
  try { void navigator.clipboard?.writeText(flow.addr) } catch { /* clipboard may be blocked */ }
  ui.showToast('Address copied')
}
</script>

<template>
  <section class="screen result">
    <header class="page-head">
      <div class="addr-row">
        <span class="mono addr">{{ e.addr }}</span>
        <button class="btn btn-ghost btn-sm" type="button" @click="copyAddr">Copy</button>
        <span v-if="flow.kind === 'key'" class="badge">key · signs here</span>
        <span v-else-if="flow.kind === 'seed'" class="badge">seed · signs here</span>
        <span v-else-if="flow.kind === 'connected' || wallet.publicKey === flow.addr" class="badge">{{ wallet.name || 'wallet' }} connected</span>
      </div>
      <p v-if="flow.notice" class="note">{{ flow.notice }}</p>

      <p class="label est-label">Estimated reclaim</p>
      <p class="big"><span class="num">{{ fmt(shown) }}</span><span class="unit">SOL<Bucks :sol="flow.tot.net" paren /></span></p>
      <p class="muted">
        From {{ e.empty }} empty token account{{ e.empty === 1 ? '' : 's' }}<template v-if="extraOn"> plus the additional operations you chose</template>,
        after the Grabster fee. Exact amounts are shown before you sign.
      </p>
    </header>

    <div class="stats-row">
      <div><b>{{ e.empty }}</b><small>Empty accounts</small></div>
      <div><b>{{ fmt(e.emptySol) }}</b><small>Rent in them · SOL</small></div>
      <div><b>{{ otherKept }}</b><small>Accounts with tokens · kept</small></div>
      <div v-if="e.frozen"><b>{{ e.frozen }}</b><small>Frozen · can’t close</small></div>
    </div>

    <section class="page-section">
      <p class="kicker"><span>01</span>Accounts to close</p>
      <p class="muted">
        Closing an empty token account returns its rent deposit to the owner. Accounts that still hold tokens stay open.
      </p>
      <button v-if="emptyBoxes.length" class="link toggle" type="button" :aria-expanded="showAccounts" @click="showAccounts = !showAccounts">
        {{ showAccounts ? 'Hide' : 'Show' }} {{ emptyBoxes.length }} account{{ emptyBoxes.length === 1 ? '' : 's' }}
      </button>
      <div v-if="showAccounts" class="tscroll accounts">
        <table class="table">
          <thead><tr><th scope="col">Token account</th><th scope="col">Token</th><th scope="col" class="num">Rent</th></tr></thead>
          <tbody>
            <tr v-for="b in emptyBoxes" :key="b.address">
              <td class="mono" :title="b.address">{{ short(b.address) }}</td>
              <td>{{ b.symbol || short(b.mint) }}</td>
              <td class="num">{{ fmt(lamportsToSol(b.lamports), 6) }} SOL</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="e.dust || (e.nft && flow.cfg.features.nftBurn) || flow.canRefund" class="advanced">
        <button class="adv-toggle" type="button" :aria-expanded="flow.advanced" aria-controls="adv" @click="toggleAdvanced">
          <span>
            Additional operations
            <small class="muted">burn leftovers, burn spam NFTs, withdraw extra rent — off unless you choose them</small>
          </span>
          <span class="mono" aria-hidden="true">{{ flow.advanced ? '−' : '+' }}</span>
        </button>

        <div v-if="flow.advanced" id="adv" class="adv-body">
          <!-- token leftovers -->
          <div v-if="e.dust" class="op">
            <h3>Token leftovers <span class="muted num">· {{ e.dust }} account{{ e.dust === 1 ? '' : 's' }}</span></h3>
            <p class="muted">
              Accounts with a small token balance can only close after the tokens leave.
              <template v-if="e.dustValue"> Estimated value ~{{ withBucks(e.dustValue, flow.solUsd) }}.</template>
            </p>
            <div class="radios" role="radiogroup" aria-label="Token leftovers">
              <label class="radio">
                <input v-model="flow.dustMode" type="radio" name="dust" value="keep" />
                <span><b>Keep them</b><small>Default. Tokens stay, those accounts stay open.</small></span>
              </label>
              <label class="radio">
                <input v-model="flow.dustMode" type="radio" name="dust" value="burn" />
                <span><b>Burn and close</b><small>Destroys the tokens, returns the rent. Anything ≥ ${{ flow.cfg.keepAboveUsd }} and stablecoins are never offered.</small></span>
              </label>
              <label v-if="flow.canGive" class="radio">
                <input v-model="flow.dustMode" type="radio" name="dust" value="give" />
                <span><b>Give to Grabster and close</b><small>Tokens move to Grabster; you get {{ flow.cfg.dustShare }}% of their estimated value in SOL.</small></span>
              </label>
            </div>
            <ul v-if="flow.dustMode === 'burn' || flow.dustMode === 'give'" class="picks">
              <li v-for="b in (flow.dustMode === 'give' ? flow.sweepRows : flow.dustRows)" :key="b.address">
                <label>
                  <input type="checkbox" :checked="!flow.keepDust.includes(b.address)" @change="flow.toggleDust(b.address)" />
                  <span><b>{{ b.symbol || short(b.mint) }}</b> <span class="num">{{ tokenAmt(b) }}</span></span>
                  <span class="num muted">+{{ fmt(lamportsToSol(b.lamports), 6) }} SOL<template v-if="b.hasPrice"> · ~${{ fmt(b.netValueUsd || b.valueUsd, 2) }}</template></span>
                </label>
              </li>
            </ul>
          </div>

          <!-- spam NFTs -->
          <div v-if="e.nft && flow.cfg.features.nftBurn" class="op">
            <h3>Spam NFTs <span class="muted num">· {{ e.nft }}</span></h3>
            <label class="check">
              <input v-model="flow.nftOn" type="checkbox" />
              <span>Burn the NFTs I select and take their deposit</span>
            </label>
            <ul v-if="flow.nftOn" class="picks">
              <li v-for="b in flow.nftRows" :key="b.address">
                <label>
                  <input type="checkbox" :checked="!flow.keepNft.includes(b.address)" @change="flow.toggleNft(b.address)" />
                  <span><b>{{ b.symbol || short(b.mint) }}</b></span>
                  <span class="num muted">+{{ fmt(lamportsToSol(b.lamports + b.extraLamports), 6) }} SOL</span>
                </label>
              </li>
            </ul>
          </div>

          <!-- extra rent -->
          <div v-if="flow.canRefund && flow.cfg.features.excessRent" class="op">
            <h3>Extra rent <span class="muted num">· {{ flow.refundRows.length }} account{{ flow.refundRows.length === 1 ? '' : 's' }}</span></h3>
            <p class="muted">Some accounts you keep hold more SOL than the minimum. The surplus can come back; the accounts stay open.</p>
            <label class="check">
              <input v-model="flow.excessOn" type="checkbox" />
              <span>Withdraw the extra rent</span>
            </label>
            <ul v-if="flow.excessOn" class="picks">
              <li v-for="b in flow.refundRows" :key="b.address">
                <label>
                  <input type="checkbox" :checked="!flow.skipRefund.includes(b.address)" @change="flow.toggleRefund(b.address)" />
                  <span><b>{{ b.symbol || short(b.mint) }}</b></span>
                  <span class="num muted">+{{ fmt(lamportsToSol(b.excessLamports), 6) }} SOL</span>
                </label>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <section class="page-section">
      <p class="kicker"><span>02</span>Where the SOL goes</p>
      <div class="dest-wrap"><DestinationChoices allow-same /></div>
    </section>

    <section class="page-section">
      <p class="kicker"><span>03</span>Estimate</p>
      <div class="split sum">
        <dl class="kv">
          <div><dt>Gross recovery</dt><dd>{{ fmt(flow.tot.gross) }} SOL<Bucks :sol="flow.tot.gross" paren /></dd></div>
          <div><dt>Grabster fee · {{ flow.tot.fee }}%</dt><dd>−{{ fmt(flow.tot.feeSol, 6) }} SOL</dd></div>
          <div v-if="flow.dustMode === 'give' && flow.sweepBonusSol"><dt>Leftover credit · {{ flow.cfg.dustShare }}%</dt><dd>+{{ fmt(flow.sweepBonusSol, 6) }} SOL</dd></div>
          <div v-if="covered"><dt>Network fee · paid by Grabster, withheld (2× estimate)</dt><dd>−{{ fmt(gasWithhold, 6) }} SOL</dd></div>
          <div v-else><dt>Network fee · paid by this wallet from its SOL</dt><dd>~{{ fmt(gasSol, 6) }} SOL</dd></div>
          <div><dt>Recipient</dt><dd class="text">{{ recipient }}</dd></div>
          <div class="total"><dt>Estimated net</dt><dd>{{ fmt(flow.tot.net) }} SOL<Bucks :sol="flow.tot.net" paren /></dd></div>
        </dl>
        <div class="cta">
          <button class="btn btn-lg arrow reclaim" type="button" :disabled="acting" :aria-describedby="signerState === 'mismatch' ? 'signer-note' : undefined" @click="act">
            {{ ctaLabel }}
          </button>

          <!-- A different wallet is connected: explained here for as long as it lasts, not only in a toast. -->
          <div v-if="signerState === 'mismatch'" id="signer-note" class="signer-note" role="status">
            <p>Connected wallet cannot sign for these accounts. Switch to {{ short(flow.requiredSigner) }}.</p>
            <dl>
              <div>
                <dt>Connected wallet:</dt>
                <dd><span class="mono" :title="wallet.publicKey">{{ short(wallet.publicKey) }}</span>
                  <button class="link" type="button" @click="copy(wallet.publicKey, 'Connected address')">Copy</button></dd>
              </div>
              <div>
                <dt>Required signer:</dt>
                <dd><span class="mono" :title="flow.requiredSigner">{{ short(flow.requiredSigner) }}</span>
                  <button class="link" type="button" @click="copy(flow.requiredSigner, 'Signer address')">Copy</button></dd>
              </div>
            </dl>
            <p class="muted">
              In your wallet app, switch to that account, then reconnect here. The recipient you chose stays as it is.
            </p>
          </div>
          <p v-else-if="signerState === 'none'" class="hint">
            The owner of these accounts, {{ short(flow.requiredSigner) }}, signs. Recipient and amounts stay as chosen.
          </p>
          <p v-else-if="signerState === 'local'" class="hint">Signs in this tab with the key you entered.</p>

          <p v-if="ctaErr" class="err" role="alert">{{ ctaErr }}</p>
          <p class="hint">
            Next you’ll see the exact plan — accounts, recipient, amount, the Grabster fee and network costs — before anything is signed.
          </p>
          <button class="link" type="button" @click="router.push('/cleanup')">Check another wallet</button>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped lang="scss">
.addr-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 14px;

  .addr {
    font-size: 15px;
    overflow-wrap: anywhere;
    color: var(--ink);
    min-width: 0;
  }
}

.est-label { margin-top: 48px; font-size: 16px; }

/* The found amount: the one big purple figure on the page. */
.big {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 18px;
  margin: 10px 0 20px;

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

.page-head > .muted { font-size: 16px; max-width: 62ch; }

.page-section > .muted { font-size: 16px; max-width: 62ch; }

.toggle { margin-top: 18px; }

/* Edge to edge on its rules; the first and last cell keep the gutter. */
.accounts {
  margin: 20px calc(-1 * var(--gutter)) 0;
  max-width: none;
  max-height: 380px;
  overflow: auto;

  .table {
    th:first-child,
    td:first-child { padding-left: var(--gutter); }

    th:last-child,
    td:last-child { padding-right: var(--gutter); }
  }
}

/* Opt-in operations: a full-width strip that runs down to the section rule. */
.advanced {
  margin: 48px calc(-1 * var(--gutter)) -64px;
  border-top: 1px solid var(--line-2);

  @media (max-width: 640px) { margin-bottom: -44px; margin-top: 36px; }
}

.adv-toggle {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 64px;
  align-items: stretch;
  min-height: 72px;
  padding: 0;
  background: none;
  border: 0;
  color: var(--ink);
  text-align: left;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;

  > span:first-child {
    padding: 18px var(--gutter);
    font-size: clamp(22px, 2.2vw, 32px);
    font-weight: 500;
    letter-spacing: -0.025em;
    line-height: 1.1;
  }

  small { display: block; font-size: 14px; letter-spacing: 0; margin-top: 6px; line-height: 1.4; }

  .mono {
    display: grid;
    place-items: center;
    border-left: 1px solid var(--line-2);
    font-size: 22px;
    color: var(--ink);
  }

  &:hover > span:first-child { color: var(--accent-text); }

  &:focus-visible { outline-offset: -3px; }

  &[aria-expanded='true'] {
    border-bottom: 1px solid var(--line-2);

    .mono { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
  }
}

/* Each operation is a column cell on the strip. */
.adv-body {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr));
  overflow: hidden;

  @media (max-width: 640px) { grid-template-columns: minmax(0, 1fr); }
}

.op {
  display: grid;
  align-content: start;
  gap: 12px;
  min-width: 0;
  padding: 28px var(--gutter) 40px;
  margin: -1px 0 0 -1px;
  border-top: 1px solid var(--line-2);
  border-left: 1px solid var(--line-2);

  h3 { font-size: 24px; }
  h3 .num { font-family: var(--display); font-weight: 500; letter-spacing: -0.02em; }
  p.muted { font-size: 15px; }
}

.radios { display: grid; border-top: 1px solid var(--line-2); }

.radio,
.check {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
  padding: 14px 0;
  cursor: pointer;
  font-size: 15px;

  input { margin-top: 2px; }
  b { display: block; font-weight: 600; }
  small { display: block; color: var(--muted); font-size: 13.5px; margin-top: 2px; }
}

.radio { border-bottom: 1px solid var(--line-2); }

.check { border-top: 1px solid var(--line-2); border-bottom: 1px solid var(--line-2); }

.picks {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 280px;
  overflow: auto;
  /* A scroll list keeps a visible edge so it reads as one block. */
  border: 1px solid var(--line-3);
  background: var(--surface);
  scrollbar-width: thin;
  scrollbar-color: var(--line-3) transparent;

  li + li { border-top: 1px solid var(--line-2); }

  label {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    min-height: 48px;
    padding: 10px 14px;
    cursor: pointer;
    font-size: 14.5px;

    b { font-weight: 600; }
    .num { font-size: 13px; }
  }

  label:hover { background: var(--bg-2); }

  /* Left out: quieter, but still readable so it can be picked again. */
  li:has(input:not(:checked)) {
    color: var(--muted);

    b { font-weight: 400; }
  }
}

.dest-wrap { max-width: 920px; }

.cta {
  display: grid;
  align-content: start;
  gap: 16px;
  justify-items: start;

  .btn-lg { justify-self: stretch; }
  .hint { margin: 0; }
}

/* The main action: purple at rest, full width of its column, next to the total. */
.btn.reclaim {
  min-height: 64px;
  font-size: 19px;
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-ink);

  &:hover:not(:disabled) { background: var(--accent-2); border-color: var(--accent-2); }
}

.signer-note {
  justify-self: stretch;
  display: grid;
  gap: 10px;
  padding: 16px 18px;
  background: var(--surface);
  border-left: 3px solid var(--bad);
  font-size: 15px;

  > p:first-child { font-weight: 600; color: var(--ink); }

  dl { display: grid; gap: 6px; margin: 0; }

  dl div { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }

  dt { color: var(--muted); }

  dd { display: flex; align-items: baseline; gap: 10px; margin: 0; }

  .link { font-size: 14px; }
}
</style>
