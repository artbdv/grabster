<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import PartnerKeyBox from '../components/PartnerKeyBox.vue'
import { apiOrigin } from '../lib/api'
import { useStateStore, useUiStore } from '../stores'

const ui = useUiStore()
const flow = useStateStore()

const cfg = computed(() => flow.cfg)
const limits = computed(() => cfg.value.limits)
const fee = computed(() => cfg.value.feeDirect)
const mcpUrl = `${apiOrigin}/mcp`

/* ---------- key ---------- */

const apiKey = ref('')

function onKey(value: string) {
  apiKey.value = value
}

/** Shown on screen: shortened. Copied: the full key. */
const keyShown = computed(() => {
  const value = apiKey.value
  if (!value) return 'YOUR_KEY'
  return value.length < 12 ? '••••••••' : `${value.slice(0, 6)}…${value.slice(-4)}`
})
const keyCopied = computed(() => apiKey.value || 'YOUR_KEY')

/* ---------- client configs ---------- */

type Client = 'cursor' | 'codex' | 'claude'
const CLIENTS: { id: Client; label: string }[] = [
  { id: 'cursor', label: 'Cursor' },
  { id: 'codex', label: 'Codex' },
  { id: 'claude', label: 'Claude' },
]
const client = ref<Client>('cursor')

function cursorJson(key: string) {
  return `{
  "mcpServers": {
    "grabster": {
      "url": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer ${key}"
      }
    }
  }
}`
}

function codexToml(key: string) {
  return `[mcp_servers.grabster]
url = "${mcpUrl}"
http_headers = { Authorization = "Bearer ${key}" }`
}

function claudeUrl(key: string) {
  return `${mcpUrl}?key=${encodeURIComponent(key)}`
}

function configFor(id: Client, key: string) {
  if (id === 'cursor') return cursorJson(key)
  if (id === 'codex') return codexToml(key)
  return claudeUrl(key)
}

const configShown = computed(() => configFor(client.value, keyShown.value))
const configCopied = computed(() => configFor(client.value, keyCopied.value))

const configLabel = computed(() => {
  if (client.value === 'cursor') return 'Cursor · ~/.cursor/mcp.json'
  if (client.value === 'codex') return 'Codex · ~/.codex/config.toml'
  return 'Claude · custom connector URL'
})

function onTabKey(e: KeyboardEvent) {
  const i = CLIENTS.findIndex((c) => c.id === client.value)
  let next = -1
  if (e.key === 'ArrowRight') next = (i + 1) % CLIENTS.length
  else if (e.key === 'ArrowLeft') next = (i - 1 + CLIENTS.length) % CLIENTS.length
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = CLIENTS.length - 1
  if (next < 0) return
  e.preventDefault()
  client.value = CLIENTS[next].id
  document.getElementById(`mcp-tab-${CLIENTS[next].id}`)?.focus()
}

/* ---------- example task ---------- */

const TASK = `Check this list of wallets and show the available rent and fees before doing anything.

WALLET_ADDRESS_1
WALLET_ADDRESS_2
WALLET_ADDRESS_3`

/* ---------- key check (GET /v1/partner/me) ---------- */

type CheckState = 'idle' | 'busy' | 'ok' | 'invalid' | 'limited' | 'error'
const checkKey = ref('')
const checkState = ref<CheckState>('idle')
const checkNote = ref('')

watch(apiKey, (value) => {
  if (value && !checkKey.value) checkKey.value = value
})

const checkData = computed(() => {
  if (checkState.value === 'busy') return 'wait'
  if (checkState.value === 'ok') return 'ok'
  if (checkState.value === 'idle') return 'none'
  return 'bad'
})

const checkLabel = computed(() => {
  switch (checkState.value) {
    case 'busy': return 'Checking'
    case 'ok': return 'Key works'
    case 'invalid': return 'Key not accepted'
    case 'limited': return 'Rate-limited'
    case 'error': return 'API unreachable'
    default: return 'Not checked'
  }
})

async function runCheck() {
  const key = checkKey.value.trim()
  if (!key || checkState.value === 'busy') return
  checkState.value = 'busy'
  checkNote.value = ''
  try {
    const res = await fetch(`${apiOrigin}/v1/partner/me`, { headers: { Authorization: `Bearer ${key}` } })
    if (res.ok) {
      checkState.value = 'ok'
      checkNote.value = 'The API accepts this key. Your MCP client can use it.'
    } else if (res.status === 401) {
      checkState.value = 'invalid'
      checkNote.value = 'Copy the key again, or create a new one. A replaced key stops working.'
    } else if (res.status === 429) {
      const wait = Number(res.headers.get('Retry-After'))
      checkState.value = 'limited'
      checkNote.value = wait > 0
        ? `The key works but hit its per-minute limit. Try again in ${wait} s.`
        : 'The key works but hit its per-minute limit. Try again within a minute.'
    } else {
      checkState.value = 'error'
      checkNote.value = `The API answered ${res.status}.`
    }
  } catch {
    checkState.value = 'error'
    checkNote.value = 'Could not reach the API from this browser.'
  }
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    ui.showToast('Copied')
  } catch {
    ui.showToast('Copy is blocked in this browser')
  }
}
</script>

<template>
  <section class="screen mcp">
    <header class="page-head">
      <h1>Give an AI agent the Grabster tools.</h1>
      <p class="lede">
        An MCP client can check a list of addresses, prepare a reclaim plan, and pass owner-signed transactions back —
        with four tools and nothing else. The agent never signs. The wallet owner does.
      </p>
      <p class="fee-line">
        Free access with your API key: no subscription, no per-request charge. Every plan carries the Grabster fee —
        {{ fee }}% of recovered rent, a transfer inside its transactions — plus Solana network fees.
      </p>
    </header>

    <!-- 01 What an agent can do -->
    <section class="page-section" aria-labelledby="can-title">
      <p class="kicker"><span>01</span>What the agent can do</p>
      <div class="split">
        <div>
          <h2 id="can-title">Read, plan, hand over. Signing stays with the owner.</h2>
          <p class="lede small-lede">
            The tools wrap the same Partner API: scan, plan, submit. A plan is a set of unsigned transactions. Someone with the
            wallet has to sign them in their wallet before <span class="mono">submit_signed</span> can send anything.
          </p>
        </div>
        <div>
          <ol class="steps-list">
            <li><b>Check addresses</b><p>The agent scans one wallet or a list and reports empty token accounts and the SOL locked in them.</p></li>
            <li><b>Prepare a plan</b><p>For one wallet, it builds unsigned transactions and reads the fee, the network-fee payer and what comes back.</p></li>
            <li><b>Owner signs — outside the agent</b><p>The wallet owner signs those transactions in their own wallet. The agent can't do this step.</p></li>
            <li><b>Pass signed transactions</b><p>The agent sends the signed bytes with the planId. The server checks each one against the plan before broadcasting it.</p></li>
          </ol>
        </div>
      </div>
    </section>

    <!-- 02 Setup -->
    <section class="page-section" aria-labelledby="setup-title">
      <p class="kicker"><span>02</span>Setup</p>
      <div class="split">
        <div class="stack">
          <h2 id="setup-title">Connect a client.</h2>
          <p class="lede small-lede">
            One endpoint, the same key as the API. Clients that support headers send
            <code class="inline">Authorization: Bearer</code>; clients that only take a URL can pass <code class="inline">?key=</code>.
          </p>
          <div class="code-block">
            <div class="code-head">
              <span>MCP endpoint · HTTP, JSON-RPC over POST</span>
              <button class="btn btn-sm btn-ghost" type="button" @click="copy(mcpUrl)">Copy</button>
            </div>
            <pre class="code">{{ mcpUrl }}</pre>
          </div>
          <PartnerKeyBox @key="onKey" />
        </div>

        <div class="stack">
          <div class="tabs" role="tablist" aria-label="MCP client" @keydown="onTabKey">
            <button
              v-for="c in CLIENTS"
              :id="`mcp-tab-${c.id}`"
              :key="c.id"
              type="button"
              role="tab"
              :aria-selected="client === c.id"
              :tabindex="client === c.id ? 0 : -1"
              aria-controls="mcp-panel"
              :class="{ on: client === c.id }"
              @click="client = c.id"
            ><span class="glyph" :style="{ '--glyph': `url('/clients/${c.id}.svg')` }" aria-hidden="true"></span>{{ c.label }}</button>
          </div>
          <div id="mcp-panel" role="tabpanel" :aria-labelledby="`mcp-tab-${client}`" class="stack">
            <div class="code-block">
              <div class="code-head">
                <span>{{ configLabel }}</span>
                <button class="btn btn-sm btn-ghost" type="button" @click="copy(configCopied)">Copy</button>
              </div>
              <pre class="code">{{ configShown }}</pre>
            </div>
            <p v-if="client === 'cursor'" class="hint">
              Cursor: Settings → MCP, or paste the block into <code class="inline">~/.cursor/mcp.json</code>.
            </p>
            <p v-else-if="client === 'codex'" class="hint">
              Codex reads <code class="inline">~/.codex/config.toml</code>. Add the block there, and don't commit that file with the key in it.
            </p>
            <div v-else class="callout">
              <b>The key is inside this URL.</b> Claude: Settings → Connectors → Add custom connector, then paste it.
              Anyone with the link can use your key and its rate limit — don't share it. If it leaks, create a new key.
            </div>
            <p class="hint">
              <template v-if="apiKey">The block shows a shortened key; Copy puts your full key in it.</template>
              <template v-else>Sign in to fill in your key, or replace YOUR_KEY yourself.</template>
            </p>
          </div>

          <div class="check">
            <p class="label">Check key</p>
            <p class="muted check-help">
              Calls <code class="inline">GET /v1/partner/me</code> with the key. It tells you whether the API accepts the key —
              not whether your MCP client is connected. It counts as one request.
            </p>
            <label class="field-label" for="mcp-check-key">API key</label>
            <div class="check-line">
              <input
                id="mcp-check-key"
                v-model="checkKey"
                class="input"
                type="password"
                spellcheck="false"
                autocomplete="off"
                placeholder="Paste a key, or sign in"
              />
              <button class="btn btn-ghost" type="button" :disabled="!checkKey.trim() || checkState === 'busy'" @click="runCheck">Check key</button>
            </div>
            <p class="check-result" role="status" aria-live="polite">
              <span class="status" :data-s="checkData">{{ checkLabel }}</span>
              <span v-if="checkNote" class="muted">{{ checkNote }}</span>
            </p>
          </div>

          <p class="hint">
            For clients that only start local commands, the Grabster source includes a stdio bridge,
            <span class="mono">grabster-mcp</span>, with the same four tools. It reads <code class="inline">GRABSTER_API_URL</code>
            and <code class="inline">GRABSTER_API_KEY</code>. It isn't published as a package, so the HTTP endpoint above is the
            simplest way to connect.
          </p>
        </div>
      </div>
    </section>

    <!-- 03 Example task -->
    <section class="page-section" aria-labelledby="task-title">
      <p class="kicker"><span>03</span>Example task for the agent</p>
      <div class="split">
        <div>
          <h2 id="task-title">Start with a check, not an action.</h2>
          <p class="lede small-lede">
            Give the agent addresses only. It can scan them<template v-if="limits"> ({{ limits.partnerBatch }} per call)</template>,
            and build a plan per wallet to read the exact fee and payout. A plan sends nothing; it expires<template v-if="limits">
            after {{ limits.planTtlSec }} s</template> unless signed transactions come back.
          </p>
          <div class="callout rule-box">
            <b>Never paste a private key or seed phrase into the chat.</b> The agent doesn't need one, and the tools reject
            arguments named <span class="mono">secret</span>, <span class="mono">privateKey</span>, <span class="mono">mnemonic</span>,
            <span class="mono">seed</span> or <span class="mono">keypair</span>. Signing happens in the owner's wallet.
          </div>
        </div>
        <div>
          <div class="code-block">
            <div class="code-head">
              <span>Prompt</span>
              <button class="btn btn-sm btn-ghost" type="button" @click="copy(TASK)">Copy</button>
            </div>
            <pre class="code prompt">{{ TASK }}</pre>
            <p class="hint">Replace the placeholders with public wallet addresses.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 04 Tools -->
    <section class="page-section" aria-labelledby="tools-title">
      <p class="kicker"><span>04</span>Tools</p>
      <h2 id="tools-title" class="section-title">Four tools, same rules as the API.</h2>
      <div class="tscroll">
        <table class="table tools">
          <caption class="sr-only">MCP tools</caption>
          <thead>
            <tr><th scope="col">Tool</th><th scope="col">Input</th><th scope="col">Returns</th></tr>
          </thead>
          <tbody>
            <tr>
              <td class="mono">scan_address</td>
              <td><span class="mono">address</span> — wallet address</td>
              <td><span class="mono">address, estimate, boxes, rentNow</span> — as <span class="mono">GET /v1/partner/scan/{address}</span></td>
            </tr>
            <tr>
              <td class="mono">scan_batch</td>
              <td><span class="mono">addresses</span> — 1 to 25 strings</td>
              <td><span class="mono">rows[]</span> of <span class="mono">address, estimate, error?</span></td>
            </tr>
            <tr>
              <td class="mono">plan_reclaim</td>
              <td>
                <span class="mono">address</span>, <span class="mono">dest</span> (<span class="mono">"same"</span> | <span class="mono">"other"</span>),
                <span class="mono">other?</span>, <span class="mono">burnDust?</span>, <span class="mono">refundExcess?</span>
              </td>
              <td>An unsigned plan: <span class="mono">planId, feePayer, feeLamports, netLamports, recoveredLamports, txs[]</span></td>
            </tr>
            <tr>
              <td class="mono">submit_signed</td>
              <td><span class="mono">planId</span>, <span class="mono">txs</span> — owner-signed base64, at least 1</td>
              <td><span class="mono">signatures[]</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <ul class="facts">
        <li v-if="limits">Every MCP request — including <span class="mono">tools/list</span> — counts against the key's {{ limits.partnerPerMin }} requests per minute.</li>
        <li><span class="mono">dest: "balance"</span> isn't available: SOL goes back to the wallet or to an address you name. Referral links don't apply.</li>
        <li>The fee recipient is fixed by the server. A plan whose fee would go anywhere but the Grabster treasury is refused.</li>
        <li>Tool errors come back as an error result with the message, for example <span class="mono">Invalid Solana address.</span></li>
      </ul>
    </section>
  </section>
</template>

<style scoped lang="scss">
/* White paper for everything copyable and technical, on the grey page. */
.code-block,
.code-block pre.code { background: var(--field); }

.input,
.input[readonly] { background: var(--field); }

/* Copy cells sit inside the block's frame (no overhang) and stay easy to hit. */
.code-head .btn {
  margin: 0;
  min-width: 72px;
  min-height: 40px;
  justify-content: center;

  @media (max-width: 640px) { min-height: 44px; }
}

/* Client marks: one mask, painted with the tab's own text colour. */
.glyph {
  flex: none;
  width: 18px;
  height: 18px;
  background: currentColor;
  -webkit-mask: var(--glyph) center / contain no-repeat;
  mask: var(--glyph) center / contain no-repeat;
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

.split .lede { margin-top: 24px; }

.stack {
  display: grid;
  gap: 20px;
  min-width: 0;
  align-content: start;

  > .lede { margin-top: 0; }
}

.small-lede { font-size: 17px; line-height: 1.45; }

code.inline { white-space: normal; overflow-wrap: break-word; }

.hint { margin-top: 0; }

/* Key check: its own block on a rule, field and button in one rectangle. */
.check {
  padding-top: 24px;
  border-top: 1px solid var(--line-2);
  min-width: 0;

  > .label { font-size: 18px; font-weight: 600; color: var(--ink); letter-spacing: -0.02em; }

  .check-help {
    margin: 8px 0 18px;
    font-size: 15px;
    color: var(--ink-2);
  }
}

.check-line {
  display: flex;
  align-items: stretch;

  .input { flex: 1; min-width: 0; }

  .btn { flex: none; min-height: 52px; margin-left: -1px; }

  @media (max-width: 480px) {
    flex-wrap: wrap;

    .input { flex: none; width: 100%; }
    .btn { flex: 1; margin: -1px 0 0; }
  }
}

.check-result {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 14px;
  margin-top: 14px;
  font-size: 14px;
}

.rule-box { margin-top: 28px; }

pre.code.prompt {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--ink);
}

.tools {
  td:first-child { white-space: nowrap; color: var(--ink); font-weight: 500; }

  .mono { font-size: 13px; }
}

.facts {
  list-style: none;
  margin: 32px 0 0;
  padding: 0;
  border-top: 1px solid var(--line-2);

  li {
    padding: 14px 0;
    border-bottom: 1px solid var(--line-2);
    color: var(--ink-2);
    font-size: 15px;
  }

  .mono { color: var(--ink); font-size: 13.5px; }
}
</style>
