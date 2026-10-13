<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import Bucks from '../components/Bucks.vue'
import SolIcon from '../components/SolIcon.vue'
import { fetchOps, type OpsPeriod, type OpsSnapshot } from '../lib/api'
import { pct, shortDay, shortWhen } from '../lib/dashboard-format'
import { fmt, short } from '../lib/mock'
import { useStateStore } from '../stores'

const flow = useStateStore()
const period = ref<OpsPeriod>('30d')
const PERIODS: { id: OpsPeriod; label: string }[] = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
]

const snap = ref<OpsSnapshot | null>(null)
const loading = ref(false)
const err = ref('')
let loadSeq = 0

async function load() {
  const seq = ++loadSeq
  const want = period.value
  loading.value = true
  err.value = ''
  try {
    const next = await fetchOps(want)
    if (seq !== loadSeq) return
    snap.value = next
  } catch (e) {
    if (seq !== loadSeq) return
    snap.value = null
    err.value = e instanceof Error ? e.message : 'Could not load ops figures.'
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

onMounted(() => { void load() })
watch(period, () => { tip.value = null; void load() })

const maxDayFee = computed(() => {
  const days = snap.value?.days || []
  return Math.max(...days.map((d) => d.feeSol), 0.001)
})

const shownFee = ref(0)
let raf = 0

function countFee(to: number) {
  if (raf) cancelAnimationFrame(raf)
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    shownFee.value = to
    return
  }
  const from = shownFee.value
  const t0 = performance.now()
  const dur = 700
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / dur)
    const e = 1 - (1 - k) ** 3
    shownFee.value = from + (to - from) * e
    if (k < 1) raf = requestAnimationFrame(step)
    else raf = 0
  }
  raf = requestAnimationFrame(step)
}

watch(() => snap.value?.feeSol ?? 0, (v) => countFee(v), { immediate: true })
onUnmounted(() => { if (raf) cancelAnimationFrame(raf) })

const hasCleanups = computed(() => (snap.value?.cleanups ?? 0) > 0)
/** Bars only when some day actually booked a fee — zero-fee cleanups still look empty. */
const hasChartFees = computed(() => (snap.value?.days || []).some((d) => d.feeSol > 0))
const quiet = computed(() => Boolean(snap.value) && !hasCleanups.value && (snap.value?.feeDelta ?? 0) === 0)
const feeDeltaLabel = computed(() => {
  if (!snap.value) return ''
  if (quiet.value) return 'Quiet'
  return pct(snap.value.feeDelta)
})
const feeDeltaUp = computed(() => (snap.value?.feeDelta ?? 0) >= 0)
const feeDeltaCopy = computed(() => {
  if (!snap.value) return ''
  if (quiet.value) return 'no fees this window'
  return `vs prior ${period.value}`
})

const tip = ref<{ day: string; fee: number; cleanups: number; x: number } | null>(null)

/**
 * `x` is the tip’s left edge (no translateX(-50%)). Prefer centered on the bar,
 * then clamp so neither side leaves the chart — overflow:hidden was eating the left half.
 */
async function showTip(el: EventTarget | null, day: string, fee: number, cleanups: number) {
  const cell = el instanceof HTMLElement ? el : null
  const chart = cell?.parentElement
  if (!cell || !chart) return
  const span = chart.clientWidth
  const cr = cell.getBoundingClientRect()
  const chartLeft = chart.getBoundingClientRect().left
  const center = cr.left - chartLeft + cr.width / 2
  const pad = 8
  const clampLeft = (width: number) => {
    const maxW = Math.max(0, span - pad * 2)
    const w = Math.min(width, maxW)
    return Math.min(Math.max(center - w / 2, pad), span - w - pad)
  }
  tip.value = { day, fee, cleanups, x: clampLeft(140) }
  await nextTick()
  const tipEl = chart.querySelector('.tip')
  if (!(tipEl instanceof HTMLElement) || tip.value?.day !== day) return
  tip.value = { day, fee, cleanups, x: clampLeft(tipEl.offsetWidth) }
}

function onBarLeave() {
  tip.value = null
}
</script>

<template>
  <section class="screen dash">
    <header class="page-head">
      <div class="split">
        <div class="intro">
          <p class="eyebrow"><span class="mono">Ops</span><span aria-hidden="true">·</span>Live from submits</p>
          <h1>Project pulse.</h1>
          <p class="lede">
            Volume, destinations and the Grabster fee from signed cleanups that hit this API.
            Local HTML runs are not included — they never call Grabster.
          </p>
        </div>
        <div class="profit" aria-labelledby="profit-title">
          <div class="period" role="tablist" aria-label="Time range">
            <button
              v-for="p in PERIODS"
              :key="p.id"
              type="button"
              role="tab"
              :aria-selected="period === p.id"
              :class="{ on: period === p.id }"
              @click="period = p.id"
            >{{ p.label }}</button>
          </div>
          <div class="profit-body">
            <p id="profit-title" class="profit-label">Grabster fee · profit</p>
            <p class="profit-n" aria-live="polite">
              <template v-if="snap">
                <span class="num">{{ fmt(shownFee, 3) }}</span>
                <SolIcon class="unit" :size="28" />
                <Bucks :sol="snap.feeSol" paren />
              </template>
              <span v-else-if="loading" class="muted">Loading…</span>
              <span v-else class="muted">—</span>
            </p>
            <p v-if="snap" class="profit-meta">
              <span
                class="delta"
                :data-dir="quiet ? 'flat' : feeDeltaUp ? 'up' : 'down'"
              >{{ feeDeltaLabel }}</span>
              {{ feeDeltaCopy }}
              <span class="sep" aria-hidden="true" />
              <span class="range">{{ snap.rangeLabel }}</span>
            </p>
            <p v-if="err" class="err">{{ err }}</p>
            <p v-else-if="snap && !snap.live" class="err">Database is offline — figures cannot be shown.</p>
            <dl v-if="snap" class="kv profit-kv">
              <div><dt>Returned to users</dt><dd>{{ fmt(snap.recoveredSol) }} SOL</dd></div>
              <div><dt>Avg fee / cleanup</dt><dd>{{ fmt(snap.avgFeeSol, 4) }} SOL</dd></div>
              <div><dt>Gas withheld</dt><dd>{{ fmt(snap.gasWithheldSol, 4) }} SOL</dd></div>
              <div><dt>Take rate</dt><dd>{{ flow.cfg.feeDirect }}% direct · {{ flow.cfg.feeBalance }}% balance</dd></div>
            </dl>
          </div>
        </div>
      </div>
    </header>

    <div class="stats-row" aria-label="Period totals" :aria-busy="loading || undefined">
      <div><b class="num">{{ snap ? snap.cleanups.toLocaleString('en-US') : '—' }}</b><small>Cleanups finished</small></div>
      <div><b class="num">{{ snap ? snap.wallets.toLocaleString('en-US') : '—' }}</b><small>Wallets that signed</small></div>
      <div><b class="num">{{ snap ? snap.accountsClosed.toLocaleString('en-US') : '—' }}</b><small>Accounts closed</small></div>
      <div><b class="num">{{ snap ? fmt(snap.recoveredSol) : '—' }}</b><small>SOL recovered · before fee</small></div>
      <div><b class="num accent">{{ snap ? fmt(snap.feeSol, 3) : '—' }}</b><small>Fee kept · SOL</small></div>
    </div>

    <!-- 01 Daily fee -->
    <section class="page-section" aria-labelledby="chart-title">
      <p class="kicker"><span>01</span>Daily fee</p>
      <div class="split">
        <div>
          <h2 id="chart-title">What each day brought in.</h2>
          <p class="lede small-lede">
            Service fee only — not network fees Grabster paid and withheld.
          </p>
        </div>
        <div class="chart-wrap">
          <template v-if="snap">
            <div
              class="chart"
              :class="{ quiet: !hasChartFees }"
              role="img"
              :aria-label="hasChartFees ? `Daily Grabster fee for ${snap.rangeLabel}` : `No fees in ${snap.rangeLabel}`"
            >
              <div
                v-for="d in snap.days"
                :key="d.day"
                class="bar"
                :style="{ '--h': hasChartFees ? `${(d.feeSol / maxDayFee) * 100}%` : '0%' }"
                @mouseenter="hasChartFees && showTip($event.currentTarget, d.day, d.feeSol, d.cleanups)"
                @mouseleave="onBarLeave"
                @focus="hasChartFees && showTip($event.currentTarget, d.day, d.feeSol, d.cleanups)"
                @blur="onBarLeave"
                :tabindex="hasChartFees ? 0 : -1"
                :aria-label="`${shortDay(d.day)}: ${fmt(d.feeSol, 3)} SOL fee, ${d.cleanups} cleanups`"
              >
                <span class="fill" />
              </div>
              <div v-if="!hasChartFees" class="flatline">
                <span class="mark">Flatline</span>
                <b>Waiting for the first fee.</b>
                <p>This strip wakes up when a cleanup signs in this window.</p>
              </div>
              <div
                v-else-if="tip"
                class="tip"
                :style="{ left: `${tip.x}px` }"
                role="tooltip"
              >
                <b>{{ shortDay(tip.day) }}</b>
                <span>{{ fmt(tip.fee, 3) }} SOL</span>
                <span class="muted">{{ tip.cleanups }} cleanup{{ tip.cleanups === 1 ? '' : 's' }}</span>
              </div>
            </div>
            <div class="chart-axis" aria-hidden="true">
              <span>{{ shortDay(snap.days[0]?.day || '') }}</span>
              <span>{{ shortDay(snap.days[Math.floor(snap.days.length / 2)]?.day || '') }}</span>
              <span>{{ shortDay(snap.days[snap.days.length - 1]?.day || '') }}</span>
            </div>
          </template>
          <div v-else-if="loading" class="vacant">
            <span class="mark">Loading</span>
          </div>
        </div>
      </div>
    </section>

    <!-- 02 Mix -->
    <section class="page-section" aria-labelledby="mix-title">
      <p class="kicker"><span>02</span>Where it comes from</p>
      <div class="split mix">
        <div>
          <h2 id="mix-title">Channels.</h2>
          <p class="lede small-lede">Share of finished cleanups in this window.</p>
          <div v-if="snap && !snap.channels.length" class="vacant">
            <span class="mark">Unmapped</span>
            <b>No channel mix yet.</b>
            <p>The first signed reclaim draws the split — web, batch, API or MCP.</p>
          </div>
          <ul v-else-if="snap" class="shares">
            <li v-for="c in snap.channels" :key="c.id">
              <div class="share-top">
                <span>{{ c.label }}</span>
                <span class="mono">{{ Math.round(c.share * 100) }}% · {{ fmt(c.feeSol, 3) }} SOL</span>
              </div>
              <div class="track" aria-hidden="true"><i :style="{ width: `${c.share * 100}%` }" /></div>
            </li>
          </ul>
        </div>
        <div>
          <h2 class="h-aside">Destinations.</h2>
          <p class="lede small-lede">Where recovered SOL went — and which fee band applied.</p>
          <div v-if="snap && !snap.dests.length" class="vacant">
            <span class="mark">Unrouted</span>
            <b>Nowhere to show yet.</b>
            <p>Same wallet, another address, or Grabster balance — once a plan lands.</p>
          </div>
          <ul v-else-if="snap" class="shares dests">
            <li v-for="d in snap.dests" :key="d.id">
              <div class="share-top">
                <span>{{ d.label }} <small v-if="d.feePct != null" class="muted">{{ d.feePct }}% fee</small></span>
                <span class="mono">{{ Math.round(d.share * 100) }}% · {{ fmt(d.feeSol, 3) }} SOL</span>
              </div>
              <div class="track" aria-hidden="true"><i :style="{ width: `${d.share * 100}%` }" /></div>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <!-- 03 Recent -->
    <section class="page-section" aria-labelledby="recent-title">
      <p class="kicker"><span>03</span>Recent cleanups</p>
      <div class="split">
        <div>
          <h2 id="recent-title">Last signed runs.</h2>
          <p class="lede small-lede">
            Fee is the Grabster cut inside each plan. One row per wallet that submitted through this API.
          </p>
        </div>
        <div>
          <div v-if="snap && !snap.recent.length" class="vacant">
            <span class="mark">Ledger clear</span>
            <b>The tape is blank.</b>
            <p>Each wallet that finishes a reclaim leaves a row here — fee, accounts, destination.</p>
          </div>
          <div v-else-if="snap" class="tscroll">
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">When · UTC</th>
                  <th scope="col">Channel</th>
                  <th scope="col">Wallet</th>
                  <th scope="col" class="num">Accounts</th>
                  <th scope="col" class="num">Recovered</th>
                  <th scope="col" class="num">Fee</th>
                  <th scope="col">Destination</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in snap.recent" :key="i">
                  <td class="mono">{{ shortWhen(r.when) }}</td>
                  <td>{{ r.channel }}<small v-if="r.partial" class="row-note">partial</small></td>
                  <td class="mono" :title="r.address">{{ short(r.address) }}</td>
                  <td class="num">{{ r.accounts }}</td>
                  <td class="num">{{ fmt(r.recoveredSol) }} SOL</td>
                  <td class="num fee">{{ fmt(r.feeSol, 4) }} SOL</td>
                  <td>{{ r.dest }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>

    <!-- 04 Notes -->
    <section class="page-section last" aria-labelledby="notes-title">
      <p class="kicker"><span>04</span>Reading the board</p>
      <div class="split">
        <div>
          <h2 id="notes-title">What counts as profit.</h2>
          <p class="lede small-lede">
            Grabster profit here is the service fee transfer inside reclaim transactions.
            Gas Grabster pays and withholds is cost recovery, not margin.
          </p>
        </div>
        <div>
          <ul class="notes">
            <li>
              <b>Fee profit</b>
              <p>{{ flow.cfg.feeDirect }}% when SOL goes back to a wallet or another address; {{ flow.cfg.feeBalance }}% when it credits Grabster balance.</p>
            </li>
            <li>
              <b>Not in the fee total</b>
              <p>Solana network fees paid by wallets, and rent returned to users. Withheld gas is listed separately above.</p>
            </li>
            <li>
              <b>Source of truth</b>
              <p>Every successful submit through the site, partner API or MCP writes a cleanup row. Figures before that deploy are not backfilled.</p>
            </li>
          </ul>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped lang="scss">
/* Full-bleed like other page-head screens, but never wider than the viewport. */
.dash {
  overflow-x: clip;
  min-width: 0;
}

.dash > .page-head {
  /* Horizontal gutter must stay so .split’s -gutter cancels to the edge (no side scroll). */
  padding-top: 0;
  padding-bottom: 0;

  > .split {
    margin-top: 0;
    border-top: 0;
    /*
     * Global `.page-head > .split:last-child { margin-bottom: -56px }` pulls the next
     * band up under the columns — fine when the split is the page end, fatal when a
     * stats-row follows (Take rate / Accounts closed overlap). Kill it here.
     */
    margin-bottom: 0;

    > .intro {
      padding-top: 28px;
      padding-bottom: 40px;
    }

    > .profit {
      padding-top: 0;
      padding-bottom: 40px;
    }

    @media (max-width: 640px) {
      > .intro {
        padding-top: 24px;
        padding-bottom: 32px;
      }

      > .profit { padding-bottom: 32px; }
    }
  }
}

/* Beat the global `:last-child` negative margin (same specificity needs the pseudo). */
.dash > .page-head > .split:last-child {
  margin-bottom: 0;

  > * { padding-bottom: 40px; }

  @media (max-width: 640px) {
    > * { padding-bottom: 32px; }
  }
}

.intro { min-width: 0; }

.eyebrow {
  font-size: 13px;
  color: var(--muted);
  letter-spacing: 0.04em;
  text-transform: uppercase;

  .mono { color: var(--ink-2); letter-spacing: 0.08em; }
}

.profit {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
}

/* Period strip only as wide as the profit column — flush to the header rule. */
.period {
  display: flex;
  margin: 0 calc(-1 * var(--gutter));
  border-bottom: 1px solid var(--line-2);

  button {
    flex: 1 1 0;
    min-width: 0;
    min-height: 48px;
    padding: 0 14px;
    border: 0;
    border-right: 1px solid var(--line-2);
    background: transparent;
    color: var(--muted);
    font-size: 15px;
    font-weight: 500;
    letter-spacing: -0.01em;
    text-align: left;
    cursor: pointer;

    &:last-child { border-right: 0; }
    &:hover { color: var(--ink); background: var(--accent-soft); }

    &.on,
    &[aria-selected='true'] {
      color: var(--accent-ink);
      background: var(--accent);
    }
  }
}

.profit-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 20px;
  min-width: 0;
}

.profit-label {
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

.profit-n {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 10px;
  font-family: var(--display);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  font-size: clamp(48px, 6vw, 88px);
  letter-spacing: -0.045em;
  line-height: 0.95;
  min-width: 0;

  .num { color: var(--ink); }
  .unit { align-self: center; color: var(--ink); flex: none; }
  .muted { font-size: 18px; letter-spacing: 0; }
  :deep(.bucks) { font-size: 15px; letter-spacing: 0; align-self: flex-end; margin-bottom: 0.18em; }
}

.profit-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  font-size: 15px;
  color: var(--ink-2);
  min-width: 0;

  .delta {
    font-variant-numeric: tabular-nums;
    font-weight: 600;

    &[data-dir='up'] { color: var(--accent-text); }
    &[data-dir='down'] { color: var(--bad); }
    &[data-dir='flat'] { color: var(--muted); font-weight: 500; }
  }

  /* Global `.dot` is an 8px ink square — use a tiny rule instead. */
  .sep {
    display: inline-block;
    width: 3px;
    height: 3px;
    background: var(--muted-2);
    flex: none;
  }

  .range {
    color: var(--muted);
    min-width: 0;
  }
}

.profit-kv {
  margin-top: 8px;
  border-top: 0;
}

/*
 * Five equal cells — never auto-fit wrap. auto-fit + minmax(180px) was wrapping a 5th
 * cell and letting borders land on labels like “Accounts closed”.
 */
.dash > .stats-row {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  margin: 0;
  border-top: 0;
  overflow: hidden;

  > div {
    margin: 0;
    border-top: 0;
    border-left: 1px solid var(--line-2);
    padding: 18px var(--gutter);
    min-width: 0;

    &:first-child { border-left: 0; }
  }

  b.accent { color: var(--accent-text); }

  @media (max-width: 1100px) {
    grid-template-columns: repeat(3, minmax(0, 1fr));

    > div {
      margin: 0;
      border-top: 0;
      border-left: 0;
      border-right: 1px solid var(--line-2);
      border-bottom: 1px solid var(--line-2);
    }

    /* No rule on the screen edge — only internal column dividers. */
    > div:nth-child(3n) { border-right: 0; }

    /* Last row sits on the band’s bottom rule — no double line. */
    > div:nth-child(n + 4) { border-bottom: 0; }
  }

  @media (max-width: 640px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));

    /*
     * Internal cross only: no left edge on 1/3/5, no right edge on 2/4/5.
     * Center rule from odd cells’ right border; Fee kept spans full width.
     */
    > div {
      margin: 0;
      border-top: 0;
      border-left: 0;
      border-right: 0;
      border-bottom: 1px solid var(--line-2);
    }

    /* Center rule on left column — `odd` beats 1100px `3n { border-right: 0 }` on cell 3. */
    > div:nth-child(odd) { border-right: 1px solid var(--line-2); }
    > div:nth-child(even) { border-right: 0; }

    /* Restore bottoms cleared by the 3-col last-row rule. */
    > div:nth-child(n + 4) { border-bottom: 1px solid var(--line-2); }

    > div:last-child:nth-child(odd) {
      grid-column: 1 / -1;
      border-right: 0;
    }

    > div:last-child { border-bottom: 0; }
  }
}

.chart-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.chart {
  position: relative;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  align-items: end;
  gap: 3px;
  height: 200px;
  padding-top: 12px;
  border-bottom: 1px solid var(--line-2);
  min-width: 0;
  overflow: hidden;

  @media (max-width: 640px) { height: 160px; gap: 2px; }
}

.bar {
  height: 100%;
  display: flex;
  align-items: flex-end;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: crosshair;

  .fill {
    display: block;
    width: 100%;
    height: var(--h);
    min-height: 2px;
    background: var(--ink);
    transition: background 0.15s, height 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  &:hover .fill,
  &:focus-visible .fill {
    background: var(--accent);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
}

.chart.quiet .bar {
  cursor: default;
  pointer-events: none;

  /* No 1px stubs — they read as a broken axis, not an empty chart. */
  .fill { display: none; }
}

.flatline {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  padding: 0 4px 12px;
  pointer-events: none;
  background: var(--bg);

  b {
    font-size: clamp(22px, 2.4vw, 32px);
    letter-spacing: -0.03em;
    line-height: 1.1;
    color: var(--ink);
  }

  p {
    margin: 0;
    color: var(--muted);
    font-size: 14px;
    line-height: 1.35;
    max-width: 36ch;
  }
}

.mark {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent-text);
}

.tip {
  /* `left` is the box’s left edge — clamped in showTip so overflow:hidden can’t crop it. */
  position: absolute;
  top: 8px;
  bottom: auto;
  transform: none;
  z-index: 2;
  display: grid;
  gap: 2px;
  min-width: 110px;
  max-width: min(200px, calc(100% - 16px));
  box-sizing: border-box;
  padding: 10px 12px;
  background: var(--ink);
  color: var(--bg);
  font-size: 13px;
  pointer-events: none;
  font-variant-numeric: tabular-nums;

  b { font-weight: 600; }
  .muted { opacity: 0.7; }
}

.chart-axis {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
  min-width: 0;

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.mix {
  h2.h-aside {
    font-size: clamp(28px, 2.8vw, 40px);
    letter-spacing: -0.03em;
  }
}

.shares {
  list-style: none;
  margin: 28px 0 0;
  padding: 0;
  border-top: 1px solid var(--line-2);

  li {
    padding: 16px 0;
    border-bottom: 1px solid var(--line-2);
  }
}

.share-top {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 10px;
  font-size: 15px;

  .mono {
    color: var(--ink-2);
    font-size: 13px;
  }
}

.track {
  height: 4px;
  background: var(--surface-2);
  overflow: hidden;

  i {
    display: block;
    height: 100%;
    background: var(--ink);
  }
}

.dests .track i { background: var(--accent); }

.table .fee { color: var(--accent-text); font-weight: 600; }

.row-note {
  display: block;
  margin-top: 2px;
  color: var(--muted);
  font-size: 12px;
}

/* Empty copy. No extra top rule when this is the first thing in a column
   (e.g. “The tape is blank”) — only when it follows a lede. */
.vacant {
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;

  .mark { display: block; margin-bottom: 12px; }

  b {
    display: block;
    margin-bottom: 8px;
    font-size: clamp(22px, 2.4vw, 32px);
    letter-spacing: -0.03em;
    line-height: 1.1;
  }

  p {
    margin: 0;
    color: var(--muted);
    font-size: 15px;
    line-height: 1.4;
    max-width: 40ch;
  }
}

.lede + .vacant,
.small-lede + .vacant {
  margin-top: 28px;
  padding-top: 24px;
  border-top: 1px solid var(--line-2);
}

.notes {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 0;

  li {
    padding: 20px 0;
    border-bottom: 1px solid var(--line-2);

    &:first-child { padding-top: 0; }
    &:last-child { border-bottom: 0; padding-bottom: 0; }

    b {
      display: block;
      margin-bottom: 6px;
      font-size: 17px;
      letter-spacing: -0.02em;
    }

    p {
      margin: 0;
      color: var(--ink-2);
      font-size: 15px;
      line-height: 1.45;
      max-width: 52ch;
    }
  }
}

.last { border-bottom: 0; }

.err {
  margin: 0;
  color: var(--bad);
  font-size: 14px;
}
</style>
