<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import HomeCheck from '../components/HomeCheck.vue'
import SolIcon from '../components/SolIcon.vue'
import { RENT_STAT, groupDigits, shortDate } from '../lib/home-demo'
import { useStateStore } from '../stores'

const router = useRouter()
const route = useRoute()
const flow = useStateStore()
const cfg = computed(() => flow.cfg)

const TILES = [
  { title: 'Batch cleanup', sub: 'Check a list of wallets.', to: '/cleanup?mode=list', accent: true },
  { title: 'API', sub: 'Build it into your product.', to: '/api' },
  { title: 'MCP', sub: 'Use it with your AI assistant.', to: '/mcp' },
  { title: 'Local HTML', sub: 'Run it on your computer.', to: '/local' },
]

const WAYS = computed(() => [
  {
    n: '01',
    title: 'Batch cleanup',
    body: 'Paste addresses or upload a CSV. Grabster checks the format, drops duplicates, scans every wallet and shows empty accounts, estimated rent and status for each one. Then every wallet signs its own reclaim.',
    cta: 'Open batch cleanup',
    to: '/cleanup?mode=list',
  },
  {
    n: '02',
    title: 'API',
    body: 'Scan wallets and build unsigned reclaim plans from your backend, bot or wallet app. The owner signs, you submit. Free access with a key from your profile.',
    cta: 'Read the API docs',
    to: '/api',
  },
  {
    n: '03',
    title: 'MCP',
    body: 'Give an AI assistant four tools: scan an address, scan a batch, plan a reclaim and submit signed transactions. Signing always stays with the wallet owner.',
    cta: 'Connect an assistant',
    to: '/mcp',
  },
  {
    n: '04',
    title: 'Local HTML',
    body: `One file you download and open. The interface and signing run on your computer and talk only to the RPC you choose. The same ${cfg.value.feeDirect}% service fee is inside each transaction.`,
    cta: 'Get the local file',
    to: '/local',
  },
])

function go(path: string) {
  void router.push(path)
}

/** A link to a FAQ answer (e.g. /#faq-how) opens it. */
function openHashed() {
  const id = route.hash.slice(1)
  if (!id) return
  void nextTick(() => {
    const el = document.getElementById(id)
    if (el instanceof HTMLDetailsElement) el.open = true
  })
}
onMounted(openHashed)
watch(() => route.hash, openHashed)

/* Rent figure: counts up once, the first time it scrolls into view. It shows the fixed published estimate. */
const statEl = ref<HTMLElement | null>(null)
const shownRent = ref(0)
let io: IntersectionObserver | null = null
let raf = 0

function countUp() {
  const target = RENT_STAT.value
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    shownRent.value = target
    return
  }
  const start = performance.now()
  const ms = 1300
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / ms)
    shownRent.value = target * (1 - (1 - t) ** 3)
    if (t < 1) raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
}

onMounted(() => {
  if (!statEl.value || typeof IntersectionObserver === 'undefined') {
    shownRent.value = RENT_STAT.value
    return
  }
  io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return
    io?.disconnect()
    io = null
    countUp()
  }, { threshold: 0.4 })
  io.observe(statEl.value)
})

onUnmounted(() => {
  io?.disconnect()
  cancelAnimationFrame(raf)
})

const check = ref<{ focus: () => void } | null>(null)
</script>

<template>
  <section class="screen home">
    <!-- 2. first screen: two halves -->
    <div class="hero">
      <div class="hero-left">
        <div>
          <h1>Get your<br />SOL back.</h1>
          <p class="lede">Recover SOL from unused token accounts — from one wallet or a whole list.</p>
        </div>

        <div class="facts">
          <ul class="points">
            <li>Bulk SOL recovery.</li>
            <li>You control signing. Free API access.</li>
            <li>{{ cfg.feeDirect }}% fee to support the project.</li>
          </ul>
          <aside ref="statEl" class="stat" aria-label="Token-account rent on Solana">
            <!-- The final figure sits underneath, invisible, so the count-up never changes the width. -->
            <p class="stat-n">
              <span class="stat-final" aria-hidden="true">{{ groupDigits(RENT_STAT.value) }}</span>
              <span class="stat-run" aria-hidden="true">{{ groupDigits(shownRent) }}</span>
              <span class="sr-only">{{ groupDigits(RENT_STAT.value) }}</span>
              <!-- The unit is the Solana mark (labelled SOL), the same one as the header balance. -->
              <SolIcon class="stat-unit" :size="26" />
            </p>
            <p class="stat-cap">
              {{ RENT_STAT.estimate ? 'Estimated token-account rent' : 'Token-account rent' }} · {{ shortDate(RENT_STAT.asOf) }}
              · <a :href="RENT_STAT.sourceUrl" target="_blank" rel="noopener noreferrer">Source</a>
            </p>
            <button class="stat-cta" type="button" @click="check?.focus()">See what your wallet can reclaim. <span aria-hidden="true">↓</span></button>
          </aside>
        </div>

        <HomeCheck ref="check" />
      </div>

      <nav class="tiles" aria-label="Ways to use Grabster">
        <a
          v-for="t in TILES"
          :key="t.to"
          class="tile-link"
          :class="{ accent: t.accent }"
          :href="t.to"
          @click.prevent="go(t.to)"
        >
          <span class="t-title">{{ t.title }}</span>
          <span class="t-foot">
            <span class="t-sub">{{ t.sub }}</span>
            <span class="t-arrow" aria-hidden="true">→</span>
          </span>
        </a>
      </nav>
    </div>

    <!-- 3. ways to use -->
    <section class="sec" aria-labelledby="ways-title">
      <div class="sec-head">
        <h2 id="ways-title">One tool.<br />Four ways to use it.</h2>
      </div>
      <ol class="ways">
        <li v-for="w in WAYS" :key="w.n">
          <span class="w-n">{{ w.n }}</span>
          <h3>{{ w.title }}</h3>
          <p>{{ w.body }}</p>
          <a class="btn btn-ghost arrow w-cta" :href="w.to" @click.prevent="go(w.to)">{{ w.cta }}</a>
        </li>
      </ol>
    </section>

    <!-- 5. API and MCP -->
    <section class="sec split" aria-labelledby="api-title">
      <div class="split-text">
        <h2 id="api-title">Make cleanup part of your workflow.</h2>
        <p class="lede">
          Use the API in your own tools, or connect an AI assistant through MCP. Access is free; reclaim fees still apply.
        </p>
      </div>
      <div class="split-links">
        <a class="btn btn-lg arrow" href="/api" @click.prevent="go('/api')">API documentation</a>
        <a class="btn btn-lg btn-ghost arrow" href="/mcp" @click.prevent="go('/mcp')">Set up MCP</a>
      </div>
    </section>

    <!-- 6. local HTML -->
    <section class="sec split" aria-labelledby="local-title">
      <div class="split-text">
        <h2 id="local-title">Run Grabster on your computer.</h2>
        <p class="lede">Download one HTML file. Run the interface and signing locally, using your chosen RPC.</p>
      </div>
      <div class="split-links">
        <a class="btn btn-lg arrow" href="/grabster.html" download="grabster.html">Download HTML</a>
        <a class="btn btn-lg btn-ghost arrow" href="/local" @click.prevent="go('/local')">Setup guide</a>
      </div>
    </section>

    <!-- 7. FAQ -->
    <section id="faq" class="sec" aria-labelledby="faq-title">
      <div class="sec-head">
        <h2 id="faq-title">Questions.</h2>
      </div>
      <div class="faq">
        <details>
          <summary>Do I need to connect my wallet to check it?</summary>
          <p>No. A public address is enough to scan. Reclaiming SOL requires the wallet owner’s signature.</p>
        </details>
        <details id="faq-how">
          <summary>How does a cleanup work?</summary>
          <p>
            Scan: paste a public address to find empty token accounts and the SOL locked in them. Review: see the accounts, where
            the SOL goes and every fee. Sign: approve the transactions in your wallet. Nothing moves until the owner signs.
          </p>
        </details>
        <details>
          <summary>What does Grabster close?</summary>
          <p>
            Empty token accounts by default. Optional actions, such as burning leftover tokens or NFTs, are separate and listed
            for review before signing.
          </p>
        </details>
        <details>
          <summary>What does it cost?</summary>
          <p>
            API and MCP access is free. The standard Grabster fee is {{ cfg.feeDirect }}% of recovered rent and supports the
            project.<template v-if="cfg.features.balance"> When you credit the SOL to your Grabster balance, it is {{ cfg.feeBalance }}%.</template>
            Network costs are shown separately. If Grabster covers network fees for a wallet, it deducts twice the estimated
            network fee per transaction from that wallet’s payout. Every plan shows all fees before you sign.
          </p>
        </details>
        <details>
          <summary>Can I check a whole list of wallets?</summary>
          <p>
            Yes. Paste a list or upload a CSV in Batch cleanup. Each wallet’s reclaim transactions still need to be signed by its owner.
          </p>
        </details>
        <details>
          <summary>How do I get an API key?</summary>
          <p>
            Sign in with a wallet and open Profile → API key. One key works for both API and MCP, with a limit of
            {{ cfg.limits?.partnerPerMin ?? 60 }} requests per minute.
          </p>
        </details>
        <details>
          <summary>Does the local file work offline?</summary>
          <p>
            The interface and signing run on your computer. Reading Solana and sending transactions still require internet access
            and an RPC.
          </p>
        </details>
      </div>
    </section>
  </section>
</template>

<style scoped lang="scss">
/* The home page runs edge to edge; sections meet on 1px rules. */
.home {
  width: calc(100% + 2 * var(--gutter));
  margin: 0 calc(-1 * var(--gutter)) -64px;
}

/* ---------- first screen ---------- */
.hero {
  display: grid;
  grid-template-columns: 1fr 1fr;
  min-height: calc(100vh - 64px);
  border-bottom: 1px solid var(--line-2);

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
    min-height: 0;
  }
}

.hero-left {
  display: flex;
  flex-direction: column;
  padding: 28px var(--gutter) var(--gutter);
  border-right: 1px solid var(--line-2);

  h1 { font-size: clamp(56px, 7vw, 120px); }

  > div:first-child { padding-bottom: 32px; }

  .hc { margin-top: 20px; }

  .lede {
    margin-top: 24px;
    font-size: clamp(22px, 2.2vw, 32px);
    line-height: 1.12;
    letter-spacing: -0.02em;
    color: var(--ink);
    max-width: 22ch;
  }

  @media (max-width: 900px) {
    border-right: 0;
    border-bottom: 1px solid var(--line-2);
  }
}

.points {
  list-style: none;
  margin: 32px 0 0;
  padding: 0;
  display: grid;
  border-top: 1px solid var(--line-2);
  max-width: 560px;

  li {
    padding: 12px 0;
    border-bottom: 1px solid var(--line-2);
    font-size: 18px;
    font-weight: 500;
  }
}

/* Benefits and the rent figure side by side, right above the check form they lead into. */
.facts {
  display: grid;
  grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
  margin-top: auto;
  border-top: 1px solid var(--line-2);

  .points {
    margin: 0;
    border-top: 0;
    max-width: none;
    border-right: 1px solid var(--line-2);
  }

  @media (max-width: 1100px) and (min-width: 901px), (max-width: 640px) {
    grid-template-columns: minmax(0, 1fr);

    .points { border-right: 0; }
  }
}

.stat {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 6px;
  padding: 12px 0 12px 18px;
  border-bottom: 1px solid var(--line-2);

  @media (max-width: 1100px) and (min-width: 901px), (max-width: 640px) { padding-left: 0; }
}

.stat-n {
  display: grid;
  grid-template-columns: auto auto;
  justify-content: start;
  align-items: baseline;
  column-gap: 8px;
  font-family: var(--display);
  font-weight: 700;
  font-size: clamp(28px, 2.6vw, 40px);
  letter-spacing: -0.035em;
  line-height: 0.95;
  font-variant-numeric: tabular-nums;

  .stat-final,
  .stat-run { grid-area: 1 / 1; white-space: nowrap; }

  .stat-final { visibility: hidden; }

  /* Counts up from the right, like a meter, inside the reserved width. */
  .stat-run { justify-self: end; }

  .stat-unit { grid-area: 1 / 2; align-self: center; }
}

.stat-cap {
  font-size: 13px;
  color: var(--muted);

  a { color: var(--ink); text-underline-offset: 3px; }
  a:hover { color: var(--accent-text); }
}

.stat-cta {
  align-self: flex-start;
  padding: 2px 0;
  background: none;
  border: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--accent-text);
  text-align: left;
  cursor: pointer;

  &:hover { text-decoration: underline; text-underline-offset: 4px; }
}

.tiles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;

  @media (max-width: 560px) {
    grid-template-columns: 1fr;
    grid-template-rows: none;
  }
}

.tiles:hover .tile-link.accent:not(:hover),
.tiles:has(.tile-link:focus-visible) .tile-link.accent:not(:focus-visible) {
  color: var(--ink);

  &::before { opacity: 0; }

  .t-foot, .t-arrow { border-color: var(--line-2); }
}

.tile-link {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 220px;
  padding: 24px var(--gutter) 0;
  color: var(--ink);
  text-decoration: none;
  border-bottom: 1px solid var(--line-2);
  transition: background 0.15s, color 0.15s;

  &:nth-child(odd) { border-right: 1px solid var(--line-2); }
  &:nth-child(n + 3) { border-bottom: 0; }

  .t-title {
    font-size: clamp(36px, 4vw, 64px);
    font-weight: 600;
    letter-spacing: -0.035em;
    line-height: 0.95;
  }

  .t-foot {
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    margin: 0 calc(-1 * var(--gutter));
    border-top: 1px solid var(--line-2);
  }

  .t-sub {
    display: flex;
    align-items: center;
    padding: 16px var(--gutter);
    font-size: 17px;
  }

  .t-arrow {
    display: grid;
    place-items: center;
    width: 64px;
    border-left: 1px solid var(--line-2);
    font-family: var(--mono);
    font-size: 18px;
  }

  /*
   * Hover / keyboard focus: a Solana-colour gradient (purple, blue, green), one per card, faded in on a
   * layer so the card never changes size. Batch cleanup is lit by default; pointing at or focusing any
   * card in the grid lights only that one, and leaving the grid brings Batch cleanup back.
   */
  position: relative;
  isolation: isolate;
  transition: color 0.2s;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    background: var(--g);
    opacity: 0;
    transition: opacity 0.2s;
  }

  &:nth-child(1) { --g: linear-gradient(135deg, #8A3CF0 0%, #6F3FF5 50%, #4B3BE0 100%); --on: #FFFFFF; }
  &:nth-child(2) { --g: linear-gradient(160deg, #8FE6FF 0%, #3CBCFF 60%, #2FA4F5 100%); --on: #0E0E0D; }
  &:nth-child(3) { --g: linear-gradient(135deg, #14F195 0%, #4FEFC4 50%, #34D3F5 100%); --on: #0E0E0D; }
  &:nth-child(4) { --g: linear-gradient(45deg, #8A3CF0 0%, #5146F0 50%, #2A5BE8 100%); --on: #FFFFFF; }

  &:hover,
  &:focus-visible,
  &.accent {
    color: var(--on);

    &::before { opacity: 1; }

    .t-foot, .t-arrow { border-color: color-mix(in srgb, var(--on) 45%, transparent); }
  }

  &:focus-visible { outline-offset: -4px; outline-color: var(--on); }

  @media (max-width: 560px) {
    min-height: 150px;

    &:nth-child(odd) { border-right: 0; }
    &:nth-child(n + 3) { border-bottom: 1px solid var(--line-2); }
    &:last-child { border-bottom: 0; }
  }
}

/* ---------- sections ---------- */
.sec {
  border-bottom: 1px solid var(--line-2);
}

.sec-head {
  padding: 72px var(--gutter) 40px;

  @media (max-width: 640px) { padding: 48px var(--gutter) 28px; }
}

.ways {
  list-style: none;
  margin: 0;
  padding: 0;

  li {
    display: grid;
    grid-template-columns: 96px minmax(0, 4fr) minmax(0, 5fr) minmax(0, 3fr);
    align-items: start;
    border-top: 1px solid var(--line-2);
    min-height: 200px;
  }

  li > * { padding: 24px var(--gutter); }

  .w-n {
    font-family: var(--mono);
    font-size: 14px;
    color: var(--muted);
    border-right: 1px solid var(--line-2);
    align-self: stretch;
  }

  h3 { font-size: clamp(32px, 3.6vw, 56px); }

  p {
    font-size: 18px;
    line-height: 1.35;
    color: var(--ink-2);
    max-width: 52ch;
  }

  .w-cta {
    margin: 24px var(--gutter);
    padding-left: 16px;
    justify-self: stretch;
  }

  @media (max-width: 1000px) {
    li { grid-template-columns: 64px minmax(0, 1fr); min-height: 0; }
    li > :not(.w-n) { grid-column: 2; }
    .w-n { grid-row: span 3; }
    li > * { padding: 16px var(--gutter); }
    p { padding-top: 0; }
    .w-cta { margin: 0 var(--gutter) 24px; }
  }
}

.split {
  display: grid;
  grid-template-columns: 1fr 1fr;

  @media (max-width: 900px) { grid-template-columns: 1fr; }
}

.split-text {
  padding: 72px var(--gutter);
  border-right: 1px solid var(--line-2);

  h2 { max-width: 14ch; }

  .lede {
    margin-top: 28px;
    font-size: 20px;
    line-height: 1.3;
    color: var(--ink-2);
    max-width: 40ch;
  }

  @media (max-width: 900px) {
    padding: 48px var(--gutter) 32px;
    border-right: 0;
  }
}

.split-links {
  display: grid;
  align-content: end;
  gap: 8px;
  padding: 72px var(--gutter) var(--gutter);

  @media (max-width: 900px) { padding: 0 var(--gutter) 40px; }
}

.faq {
  border-top: 1px solid var(--line-2);

  details { border-bottom: 1px solid var(--line-2); }
  details:last-child { border-bottom: 0; }

  summary {
    display: grid;
    grid-template-columns: 1fr 64px;
    align-items: stretch;
    cursor: pointer;
    list-style: none;
    font-size: clamp(22px, 2.4vw, 34px);
    font-weight: 500;
    letter-spacing: -0.025em;
    line-height: 1.1;

    &::-webkit-details-marker { display: none; }

    &::before { content: none; }

    &::after {
      content: '+';
      display: grid;
      place-items: center;
      border-left: 1px solid var(--line-2);
      font-family: var(--mono);
      font-size: 22px;
      font-weight: 400;
    }

    > * { padding: 22px var(--gutter); }
  }

  summary {
    padding-left: var(--gutter);
    padding-top: 24px;
    padding-bottom: 24px;

    &::after { margin: -24px 0; }
  }

  summary:hover { color: var(--accent-text); }

  details[open] summary::after { content: '−'; background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }

  details p {
    padding: 0 var(--gutter) 28px;
    max-width: 72ch;
    font-size: 18px;
    line-height: 1.4;
    color: var(--ink-2);
  }
}
</style>
