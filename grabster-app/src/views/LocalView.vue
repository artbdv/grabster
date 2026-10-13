<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useStateStore, useUiStore } from '../stores'

const flow = useStateStore()
const ui = useUiStore()
const fee = computed(() => flow.cfg.feeDirect)

/** null while the HEAD request runs. */
const fileReady = ref<boolean | null>(null)
const builtIso = ref('')
const builtText = ref('')
const sizeText = ref('')

type Os = 'mac' | 'win'
const os = ref<Os>('mac')
const OSES: { id: Os; label: string }[] = [
  { id: 'mac', label: 'macOS / Linux' },
  { id: 'win', label: 'Windows' },
]

const COMMANDS = computed(() => os.value === 'mac'
  ? [
      { label: 'Go to the folder with the file', cmd: 'cd ~/Downloads' },
      { label: 'Python (often already installed)', cmd: 'python3 -m http.server 8780' },
      { label: 'Or Node.js (downloads a small helper the first time)', cmd: 'npx --yes serve -l 8780' },
    ]
  : [
      { label: 'Go to the folder with the file (PowerShell)', cmd: 'cd $env:USERPROFILE\\Downloads' },
      { label: 'Python', cmd: 'python -m http.server 8780' },
      { label: 'Or Node.js (downloads a small helper the first time)', cmd: 'npx --yes serve -l 8780' },
    ])

const localUrl = 'http://127.0.0.1:8780/grabster.html'

function onTabKey(e: KeyboardEvent) {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
  e.preventDefault()
  os.value = os.value === 'mac' ? 'win' : 'mac'
  document.getElementById(`os-tab-${os.value}`)?.focus()
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    ui.showToast('Copied')
  } catch {
    ui.showToast('Copy is blocked in this browser')
  }
}

onMounted(async () => {
  try {
    const res = await fetch('/grabster.html', { method: 'HEAD', cache: 'no-cache' })
    fileReady.value = res.ok
    if (!res.ok) return
    const modified = res.headers.get('Last-Modified')
    const date = modified ? new Date(modified) : null
    if (date && !Number.isNaN(date.getTime())) {
      builtIso.value = date.toISOString()
      builtText.value = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    }
    const bytes = Number(res.headers.get('Content-Length'))
    if (bytes > 0) sizeText.value = `${Math.round(bytes / 1024)} KB`
  } catch {
    fileReady.value = false
  }
})
</script>

<template>
  <section class="screen local">
    <header class="page-head">
      <h1>Run Grabster on your computer.</h1>
      <p class="lede">
        One HTML file. The interface runs in your browser from your disk, and transactions are signed there —
        in your wallet extension or with a key you paste into the page. Reading Solana and sending transactions still go
        through an RPC, so you need the internet.
      </p>

      <div class="download">
        <a v-if="fileReady !== false" class="btn btn-lg arrow dl" href="/grabster.html" download="grabster.html">Download HTML</a>
        <button v-else class="btn btn-lg dl" type="button" disabled>File is not on this server yet</button>
        <p class="file-meta" aria-live="polite">
          <span class="mono">grabster.html</span>
          <template v-if="builtText"> · Built <time :datetime="builtIso">{{ builtText }}</time></template>
          <template v-if="sizeText"> · {{ sizeText }}</template>
        </p>
      </div>
      <p class="fee-line">
        Grabster fee: {{ fee }}% of recovered rent, a transfer inside each transaction. The rate is fixed when the file is built
        and shown on its review screen before you sign. Solana network fees are paid by the wallet.
      </p>
    </header>

    <!-- 01 Steps -->
    <section class="page-section" aria-labelledby="steps-title">
      <p class="kicker"><span>01</span>How to use it</p>
      <div class="split">
        <div>
          <h2 id="steps-title">Six steps.</h2>
          <p class="lede small-lede">
            A downloaded copy doesn't update itself. To get a newer build, download it again and compare the date above.
          </p>
        </div>
        <div>
          <ol class="steps-list">
            <li><b>Download</b><p>Save <code class="inline">grabster.html</code>. Nothing to install.</p></li>
            <li><b>Open it</b><p>Double-click the file. A pasted key works this way; for a wallet extension, see <router-link class="link" :to="{ hash: '#localhost' }">03 · file:// or localhost</router-link>.</p></li>
            <li><b>Check the RPC</b><p>The page shows the RPC it uses for every read and send, and the full URL in its RPC field. Replace it with your own if you have one.</p></li>
            <li><b>Scan an address</b><p>Paste a wallet address and press Scan. Checking needs no private key.</p></li>
            <li><b>Choose and review</b><p>Empty accounts are closed by default. Burning selected tokens and withdrawing extra rent are opt-in. Review shows what reaches the wallet and the Grabster fee in SOL.</p></li>
            <li><b>Sign and send</b><p>Closing needs the owner's signature: connect the wallet or paste its key. The page simulates every transaction on your RPC first and stops if a simulation fails.</p></li>
          </ol>
        </div>
      </div>
    </section>

    <!-- 02 What runs where -->
    <section class="page-section" aria-labelledby="where-title">
      <p class="kicker"><span>02</span>What runs where</p>
      <div class="split">
        <div>
          <h2 id="where-title">Local interface, remote chain.</h2>
          <p class="lede small-lede">
            The file doesn't call the Grabster API. It talks to the RPC in its RPC field. Explorer links open Solscan only when
            you click them.
          </p>
        </div>
        <div class="tscroll">
          <table class="table where">
            <caption class="sr-only">Where each part runs</caption>
            <thead><tr><th scope="col">Part</th><th scope="col">Where</th></tr></thead>
            <tbody>
              <tr><td>Interface</td><td>Your browser, from the local file</td></tr>
              <tr><td>Signing</td><td>Your wallet extension, or this tab with a pasted key</td></tr>
              <tr><td>Reading Solana</td><td>The RPC shown in the file · needs internet</td></tr>
              <tr><td>Sending transactions</td><td>The same RPC · needs internet</td></tr>
              <tr><td>Checking an address</td><td>Address only · no private key</td></tr>
              <tr><td>Closing accounts</td><td>Needs the owner's signature</td></tr>
              <tr><td>A pasted key</td><td>Stays in the tab. Cleared when sending succeeds and when the tab closes. Never sent to Grabster or the RPC — only signed transactions are.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- 03 file:// vs localhost -->
    <section id="localhost" class="page-section" aria-labelledby="lh-title">
      <p class="kicker"><span>03</span>file:// or localhost</p>
      <div class="split">
        <div>
          <h2 id="lh-title">Wallet extensions need http://.</h2>
          <p class="lede small-lede">
            A double-clicked file opens as <code class="inline">file://</code>. Pasting a key works there, but Phantom and Solflare
            usually don't connect to <code class="inline">file://</code> pages. Serve the folder on your own computer and open it over
            <code class="inline">http://</code> instead. Nothing is uploaded.
          </p>
          <p class="hint">If a command isn't found, that program isn't installed. You need only one of Python or Node.js. Leave the window open while you use the page.</p>
        </div>
        <div class="stack">
          <div class="tabs" role="tablist" aria-label="Operating system" @keydown="onTabKey">
            <button
              v-for="o in OSES"
              :id="`os-tab-${o.id}`"
              :key="o.id"
              type="button"
              role="tab"
              :aria-selected="os === o.id"
              :tabindex="os === o.id ? 0 : -1"
              aria-controls="os-panel"
              :class="{ on: os === o.id }"
              @click="os = o.id"
            >{{ o.label }}</button>
          </div>
          <div id="os-panel" role="tabpanel" :aria-labelledby="`os-tab-${os}`" class="stack">
            <div v-for="c in COMMANDS" :key="c.cmd" class="code-block">
              <div class="code-head">
                <span>{{ c.label }}</span>
                <button class="btn btn-sm btn-ghost" type="button" @click="copy(c.cmd)">Copy</button>
              </div>
              <pre class="code">{{ c.cmd }}</pre>
            </div>
            <div class="code-block">
              <div class="code-head">
                <span>Then open in the browser</span>
                <button class="btn btn-sm btn-ghost" type="button" @click="copy(localUrl)">Copy</button>
              </div>
              <pre class="code">{{ localUrl }}</pre>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 04 Capabilities -->
    <section class="page-section" aria-labelledby="caps-title">
      <p class="kicker"><span>04</span>What this build does</p>
      <h2 id="caps-title" class="section-title">Smaller than the website, on purpose.</h2>
      <div class="tscroll">
        <table class="table caps">
          <caption class="sr-only">Local file capabilities</caption>
          <thead><tr><th scope="col">Feature</th><th scope="col">In the local file</th></tr></thead>
          <tbody>
            <tr><td>Close empty token accounts</td><td><span class="status" data-s="ok">Yes</span></td></tr>
            <tr><td>Burn selected tokens</td><td><span class="status" data-s="ok">Yes</span> <span class="muted">· one wallet at a time</span></td></tr>
            <tr><td>Withdraw extra rent from accounts you keep</td><td><span class="status" data-s="ok">Yes</span></td></tr>
            <tr><td>A list of private keys</td><td><span class="status" data-s="ok">Yes</span> <span class="muted">· one key per line; closes empty accounts and withdraws extra rent on each wallet; no burns</span></td></tr>
            <tr><td>SOL goes to</td><td>The same wallet</td></tr>
            <tr><td>Network fees</td><td>Paid by the wallet; it needs a little SOL</td></tr>
            <tr><td>Dust sweep (give leftovers)</td><td><span class="status" data-s="none">No</span></td></tr>
            <tr><td>NFT burn</td><td><span class="status" data-s="none">No</span></td></tr>
            <tr><td>Grabster balance</td><td><span class="status" data-s="none">No</span></td></tr>
            <tr><td>Referrals</td><td><span class="status" data-s="none">No</span></td></tr>
            <tr><td>Token prices</td><td><span class="status" data-s="none">No</span></td></tr>
          </tbody>
        </table>
      </div>
      <div class="callout note-box">
        <b>Before you start.</b> Use a computer you trust and close the tab when you're done. The fee address and rate are set when
        the file is built; a plan without the Grabster fee is refused, so don't edit the file. Checking an address needs no key;
        closing is a signed transaction you approve.
      </div>
    </section>
  </section>
</template>

<style scoped lang="scss">
/* Download: a large button with the file facts in a cell beside it. */
.download {
  display: flex;
  align-items: stretch;
  flex-wrap: wrap;
  margin-top: 40px;
  max-width: 880px;
}

.dl {
  width: auto;
  min-width: 320px;
  font-size: 20px;

  @media (max-width: 560px) { width: 100%; min-width: 0; }
}

.file-meta {
  display: block;
  align-content: center;
  padding: 10px 18px;
  border: 1px solid var(--line-3);
  border-left: 0;
  font-family: var(--mono);
  font-size: 13px;
  color: var(--ink-2);
  background: var(--field);

  .mono { color: var(--ink); margin-right: 6px; }

  @media (max-width: 560px) {
    width: 100%;
    border-left: 1px solid var(--line-3);
    border-top: 0;
  }
}

.fee-line {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--line-2);
  font-family: var(--mono);
  font-size: 13px;
  line-height: 1.6;
  color: var(--ink-2);
  max-width: 80ch;
}

/* Copy cells sit inside the block's frame (no overhang) and stay easy to hit. */
.code-head .btn {
  margin: 0;
  min-width: 72px;
  min-height: 40px;
  justify-content: center;

  @media (max-width: 640px) { min-height: 44px; }
}

.split .lede { margin-top: 24px; }

.stack {
  display: grid;
  gap: 16px;
  min-width: 0;
  align-content: start;
}

.small-lede { font-size: 17px; line-height: 1.45; }

code.inline { white-space: normal; overflow-wrap: break-word; }

.where td:first-child,
.caps td:first-child {
  color: var(--ink);
  font-weight: 500;
  white-space: nowrap;
}

.where td:last-child,
.caps td:last-child { color: var(--ink-2); }

.caps td:first-child { white-space: normal; min-width: 180px; }

.note-box { margin-top: 32px; max-width: 80ch; }
</style>
