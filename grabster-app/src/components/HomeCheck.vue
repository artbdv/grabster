<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { ScanResponse } from '@grabster/solana-core'
import { ApiError, fetchScan } from '../lib/api'
import { classifyLoose } from '../lib/bulk-input'
import { DEMO_WALLETS, shortDate } from '../lib/home-demo'
import { fmt, short } from '../lib/mock'
import { useStateStore, useUiStore } from '../stores'

/**
 * First-screen wallet check: a real read-only scan (GET /v1/scan/:address, the same call Cleanup's
 * single-wallet check makes). Until the visitor touches the form, it plays cached example checks
 * marked "Demo". Every state is drawn in one stacked grid cell, so switching states never changes
 * the height of the first screen.
 */

type Found = { s: 'found'; addr: string; empty: number; sol: number; res?: ScanResponse; demoDate?: string }
type View =
  | { s: 'idle' }
  | { s: 'invalid'; msg: string }
  | { s: 'checking'; addr: string; demo?: boolean }
  | Found
  | { s: 'none'; addr: string; res: ScanResponse }
  | { s: 'error'; addr: string; msg: string }

const router = useRouter()
const flow = useStateStore()
const ui = useUiStore()

const input = ref('')
const field = ref<HTMLInputElement | null>(null)
const view = ref<View>({ s: 'idle' })
/** Only the newest manual request may set the result. */
let gen = 0

defineExpose({ focus: () => field.value?.focus() })

/* ---------------- demo ---------------- */

const demoOn = ref(false)
const demoText = ref('')
let timers: number[] = []

function later(ms: number, fn: () => void) {
  timers.push(window.setTimeout(fn, ms))
}

function clearTimers() {
  timers.forEach((t) => window.clearTimeout(t))
  timers = []
}

function demoFound(i: number): Found {
  const w = DEMO_WALLETS[i % DEMO_WALLETS.length]
  return { s: 'found', addr: w.address, empty: w.empty, sol: w.emptySol, demoDate: w.checkedAt }
}

function playDemo(i: number) {
  if (!demoOn.value) return
  const w = DEMO_WALLETS[i % DEMO_WALLETS.length]
  // Type the address in, show a short check, then the cached result; then the next example.
  demoText.value = ''
  const step = 3
  const typed = Math.ceil(w.address.length / step) * 28
  for (let n = step, k = 1; n < w.address.length + step; n += step, k++) {
    later(k * 28, () => { if (demoOn.value) demoText.value = w.address.slice(0, n) })
  }
  later(typed + 250, () => { if (demoOn.value) view.value = { s: 'checking', addr: w.address, demo: true } })
  later(typed + 1150, () => { if (demoOn.value) view.value = demoFound(i) })
  later(typed + 5400, () => playDemo(i + 1))
}

function startDemo() {
  if (!DEMO_WALLETS.length || input.value || view.value.s !== 'idle') return
  demoOn.value = true
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    // Reduced motion: one static example.
    demoText.value = DEMO_WALLETS[0].address
    view.value = demoFound(0)
    return
  }
  playDemo(0)
}

/** The visitor takes over: the demo stops for good and never touches their input or result. */
function stopDemo() {
  if (!demoOn.value) return
  demoOn.value = false
  clearTimers()
  demoText.value = ''
  view.value = { s: 'idle' }
}

onMounted(() => later(700, startDemo))
onUnmounted(clearTimers)

/* ---------------- real check ---------------- */

const checking = computed(() => view.value.s === 'checking' && !demoOn.value)

function onInput(e: Event) {
  stopDemo()
  input.value = (e.target as HTMLInputElement).value
  if (view.value.s === 'invalid') view.value = { s: 'idle' }
}

function submit() {
  stopDemo()
  if (checking.value) return // one request at a time
  const raw = input.value.trim()
  if (!raw) {
    view.value = { s: 'invalid', msg: 'Paste a wallet address to check.' }
    return
  }
  const c = classifyLoose(raw)
  if (c.kind === 'seed' || c.kind === 'key') {
    view.value = { s: 'invalid', msg: 'That’s a private key or seed phrase. Nothing was sent. Paste the public address instead.' }
    return
  }
  if (c.kind !== 'address') {
    view.value = { s: 'invalid', msg: 'That doesn’t look like a Solana address.' }
    return
  }
  void check(c.addr)
}

async function check(addr: string) {
  const mine = ++gen
  view.value = { s: 'checking', addr }
  try {
    const res = await fetchScan(addr)
    if (mine !== gen || demoOn.value) return
    const e = res.estimate
    // Reclaimable rent = empty token accounts, the same default Cleanup closes.
    view.value = e.empty > 0
      ? { s: 'found', addr, empty: e.empty, sol: e.emptySol, res }
      : { s: 'none', addr, res }
  } catch (e) {
    if (mine !== gen || demoOn.value) return
    // Server answers carry a readable reason (bad address, rate limit, RPC trouble); a network failure doesn't.
    const msg = e instanceof ApiError && e.message
      ? e.message
      : 'Grabster couldn’t be reached. Check your connection and try again.'
    view.value = { s: 'error', addr, msg }
  }
}

function retry() {
  const v = view.value
  if (v.s === 'error') void check(v.addr)
}

/** Optional actions Cleanup would list for a wallet without empty accounts (leftover tokens, NFTs, extra rent). */
const extras = computed(() => {
  const v = view.value
  if (v.s !== 'none') return 0
  const e = v.res.estimate
  return e.dust + e.nft + e.excess
})

/** Hand the scan to Cleanup's single-wallet flow; its review opens on this result without a rescan. */
function proceed() {
  const v = view.value
  if ((v.s !== 'found' && v.s !== 'none') || !v.res) return
  const { addr, res } = v
  const run = () => {
    flow.adoptScan(addr, res)
    void router.push({ name: 'check', params: { address: addr } })
  }
  if (flow.shouldWarnLeave) ui.askLeave(run)
  else run()
}

/* Each pane always has content, so the stacked cell keeps the height of the tallest one. */
const foundShown = computed<Found>(() => (view.value.s === 'found' ? view.value : demoFound(0)))
const noneAddr = computed(() => (view.value.s === 'none' ? view.value.addr : DEMO_WALLETS[0]?.address || ''))
const errorMsg = computed(() => (view.value.s === 'error'
  ? view.value.msg
  : 'Grabster couldn’t be reached. Check your connection and try again.'))
const checkingAddr = computed(() => (view.value.s === 'checking' && !view.value.demo ? view.value.addr : ''))
const on = (s: View['s']) => view.value.s === s
</script>

<template>
  <div class="hc" :class="{ demo: demoOn }">
    <form class="hc-form" novalidate @submit.prevent="submit">
      <label class="sr-only" for="home-addr">Wallet address</label>
      <div class="hc-field">
        <input
          id="home-addr"
          ref="field"
          class="input"
          :value="demoOn ? demoText : input"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder="Paste a public Solana address"
          :aria-invalid="on('invalid') ? 'true' : undefined"
          :aria-describedby="on('invalid') ? 'home-addr-err' : undefined"
          @focus="stopDemo"
          @input="onInput"
        />
        <span v-if="demoOn && demoText" class="hc-demo-tag" aria-hidden="true">Demo</span>
      </div>
      <button class="btn hc-submit" type="submit" :disabled="checking">
        {{ checking ? 'Checking…' : 'Check wallet' }}
      </button>
    </form>

    <!-- All states share one grid cell; only the active one is visible. -->
    <div class="hc-out" :aria-live="demoOn ? 'off' : 'polite'">
      <div class="pane" :class="{ on: on('idle') }" :aria-hidden="!on('idle')">
        <p class="hc-meta hc-idle">Only the public address is needed. No wallet connection, no signature.</p>
      </div>

      <div class="pane" :class="{ on: on('invalid') }" :aria-hidden="!on('invalid')">
        <p id="home-addr-err" class="hc-err" :role="on('invalid') ? 'alert' : undefined">
          {{ view.s === 'invalid' ? view.msg : '' }}
        </p>
      </div>

      <div class="pane" :class="{ on: on('checking') }" :aria-hidden="!on('checking')">
        <p class="hc-label">Checking<span v-if="checkingAddr"> {{ short(checkingAddr) }}</span>…</p>
        <!-- Skeleton the size of a result. -->
        <span class="sk sk-big"></span>
        <span class="sk sk-line"></span>
        <span class="hc-bar" aria-hidden="true"><i></i></span>
      </div>

      <div class="pane hc-found" :class="{ on: on('found') }" :aria-hidden="!on('found')">
        <div class="hc-figures">
          <p class="hc-label">
            Estimated reclaimable SOL
            <span class="hc-demo-note" :class="{ off: !foundShown.demoDate }">
              Demo · example wallet {{ short(foundShown.addr) }} · checked {{ shortDate(foundShown.demoDate || DEMO_WALLETS[0]?.checkedAt || '2026-01-01') }}
            </span>
          </p>
          <p class="hc-sol"><span>{{ fmt(foundShown.sol, 4) }}</span> <small>SOL</small></p>
          <p class="hc-meta">
            <span class="tnum">{{ foundShown.empty }}</span> empty token account{{ foundShown.empty === 1 ? '' : 's' }} · before fees<template v-if="!foundShown.demoDate"> · {{ short(foundShown.addr) }}</template>
          </p>
        </div>
        <button
          class="btn arrow hc-go"
          :class="{ off: foundShown.demoDate }"
          type="button"
          :tabindex="foundShown.demoDate ? -1 : undefined"
          @click="proceed"
        >Continue to cleanup</button>
      </div>

      <div class="pane hc-found" :class="{ on: on('none') }" :aria-hidden="!on('none')">
        <div>
          <p class="hc-big">No reclaimable rent found.</p>
          <p class="hc-meta">
            {{ short(noneAddr) }} has no empty token accounts right now.
            <template v-if="extras">Cleanup lists {{ extras }} optional action{{ extras === 1 ? '' : 's' }} for it, such as burning leftover tokens.</template>
            <template v-else>Accounts that hold tokens are never closed.</template>
          </p>
        </div>
        <button
          class="btn btn-ghost arrow hc-go"
          :class="{ off: !extras }"
          type="button"
          :tabindex="extras ? undefined : -1"
          @click="proceed"
        >Review in Cleanup</button>
      </div>

      <div class="pane hc-found" :class="{ on: on('error') }" :aria-hidden="!on('error')">
        <div>
          <p class="hc-big">Couldn’t check this wallet.</p>
          <p class="hc-meta">{{ errorMsg }}</p>
        </div>
        <button class="btn btn-ghost hc-go" type="button" @click="retry">Try again</button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.hc { display: grid; }

/* Field and one solid button, butted together on a shared edge. */
.hc-form {
  display: flex;
  align-items: stretch;

  @media (max-width: 560px) { flex-direction: column; }
}

.hc-submit {
  flex: none;
  justify-content: center;
  min-height: 64px;
  min-width: 200px;
  margin-left: -1px;
  padding: 0 28px;
  font-size: 18px;

  @media (max-width: 560px) { margin: -1px 0 0; min-height: 56px; min-width: 0; }
}

.hc-field {
  position: relative;
  flex: 1;
  min-width: 0;

  /* Told apart from the button and the result by fill alone: no extra frames. */
  .input {
    width: 100%;
    min-height: 64px;
    padding: 0 20px;
    font-size: 16px;
    background: var(--field);
    border: 0;

    &[aria-invalid='true'] { box-shadow: inset 0 -2px 0 var(--bad); }

    @media (max-width: 560px) { min-height: 56px; }
  }
}

.demo .hc-field .input { color: var(--muted); padding-right: 76px; }

.hc-demo-tag {
  position: absolute;
  top: 50%;
  right: 12px;
  transform: translateY(-50%);
  padding: 3px 8px;
  background: var(--accent-soft);
  color: var(--accent-text);
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  pointer-events: none;
}

/*
 * One cell on a calm grey surface, every state stacked in it: the tallest decides the height, so nothing
 * jumps. The outgoing state disappears at once and only the incoming one fades in, so two never overlap.
 */
.hc-out {
  display: grid;
  background: var(--bg-2);
}

.pane {
  grid-area: 1 / 1;
  align-self: center;
  min-width: 0;
  padding: 18px 20px;
  visibility: hidden;
  opacity: 0;

  &.on {
    visibility: visible;
    opacity: 1;
    animation: hc-in 0.18s ease-out;
  }
}

@keyframes hc-in {
  from { opacity: 0; }
}

.hc-label {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
  font-size: 14px;
  color: var(--muted);
}

.hc-demo-note {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--accent-text);

  &.off { visibility: hidden; }
}

.hc-meta {
  font-size: 15px;
  color: var(--ink-2);
}

.hc-idle { color: var(--muted); }

.hc-err {
  color: var(--bad);
  font-size: 15px;
  font-weight: 600;
}

.hc-found {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 14px 24px;

  @media (max-width: 560px) { grid-template-columns: minmax(0, 1fr); }
}

.hc-figures { min-width: 0; }

.tnum { font-variant-numeric: tabular-nums; }

.hc-sol {
  margin: 4px 0 6px;
  font-family: var(--display);
  font-weight: 700;
  font-size: clamp(40px, 4vw, 56px);
  letter-spacing: -0.04em;
  line-height: 0.95;
  color: var(--accent-text);
  font-variant-numeric: tabular-nums;

  small { font-size: 0.45em; letter-spacing: 0; color: var(--ink); }
}

.hc-big {
  margin-bottom: 6px;
  font-size: clamp(22px, 2vw, 28px);
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.1;
}

.hc-go {
  flex: none;

  &.off { visibility: hidden; }
}

.sk {
  display: block;
  background: var(--surface-3);
  opacity: 0.55;

  &.sk-big { width: 46%; height: 44px; margin: 10px 0 8px; background: var(--surface-3); }
  &.sk-line { width: 64%; height: 14px; }
}

.hc-bar {
  display: block;
  position: relative;
  height: 3px;
  margin-top: 14px;
  overflow: hidden;
  background: var(--line-2);

  i {
    position: absolute;
    inset: 0 auto 0 0;
    width: 30%;
    background: var(--accent);
    animation: hc-slide 1s ease-in-out infinite;
  }
}

@keyframes hc-slide {
  from { transform: translateX(-100%); }
  to { transform: translateX(340%); }
}
</style>
