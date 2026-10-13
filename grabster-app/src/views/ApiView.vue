<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import PartnerKeyBox from '../components/PartnerKeyBox.vue'
import { apiOrigin } from '../lib/api'
import { fmt } from '../lib/mock'
import { useAuthStore, useStateStore, useUiStore } from '../stores'

const auth = useAuthStore()
const ui = useUiStore()
const flow = useStateStore()

const cfg = computed(() => flow.cfg)
const limits = computed(() => cfg.value.limits)
const fee = computed(() => cfg.value.feeDirect)
const specUrl = `${apiOrigin}/v1/partner/openapi.yaml`

/* ---------- key ---------- */

const apiKey = ref('')

function onKey(value: string) {
  apiKey.value = value
}

/** The page shows a shortened key; Copy puts the full one in the clipboard. */
const keyShown = computed(() => {
  const value = apiKey.value
  if (!value) return 'YOUR_KEY'
  return value.length < 12 ? '••••••••' : `${value.slice(0, 6)}…${value.slice(-4)}`
})

function exportLine(key: string) {
  return `export GRABSTER_KEY="${key}"`
}

const scanCurl = `curl ${apiOrigin}/v1/partner/scan/WALLET_ADDRESS \\
  -H "Authorization: Bearer $GRABSTER_KEY"`

const minimalShown = computed(() => `${exportLine(keyShown.value)}\n\n${scanCurl}`)
const minimalCopy = computed(() => `${exportLine(apiKey.value || 'YOUR_KEY')}\n\n${scanCurl}`)

const planCurl = `curl -X POST ${apiOrigin}/v1/partner/plan \\
  -H "Authorization: Bearer $GRABSTER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"address":"WALLET_ADDRESS","dest":"same"}'`

const signSnippet = `import { Transaction } from '@solana/web3.js'

// plan: the JSON from POST /v1/partner/plan
// wallet: the owner's wallet (extension or wallet adapter)
const unsigned = plan.txs.map((t) => Transaction.from(Buffer.from(t.tx, 'base64')))
const signed = await wallet.signAllTransactions(unsigned)
const txs = signed.map((t) =>
  Buffer.from(t.serialize({ requireAllSignatures: false })).toString('base64'))`

const submitCurl = `curl -X POST ${apiOrigin}/v1/partner/submit \\
  -H "Authorization: Bearer $GRABSTER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"planId":"PLAN_ID","txs":["SIGNED_TX_BASE64"]}'`

const batchCurl = `curl -X POST ${apiOrigin}/v1/partner/scan \\
  -H "Authorization: Bearer $GRABSTER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"addresses":["WALLET_ADDRESS_1","WALLET_ADDRESS_2","not-a-wallet"]}'`

const batchLoop = `// Your code. One plan per wallet; each owner signs their own transactions.
const { rows } = await grabster('POST', '/v1/partner/scan', { addresses })

for (const row of rows) {
  if (row.error || row.estimate.empty === 0) continue
  const plan = await grabster('POST', '/v1/partner/plan', { address: row.address, dest: 'same' })
  const txs = await ownerSigns(row.address, plan.txs) // your signing flow
  await grabster('POST', '/v1/partner/submit', { planId: plan.planId, txs })
}`

/* ---------- example responses, built from the real schema ---------- */

const EXAMPLE_EMPTY = 12
const rentLamports = computed(() => Math.round((cfg.value.rentNow || 0) * 1e9))
const rentSol = computed(() => rentLamports.value / 1e9)
const recoveredLamports = computed(() => EXAMPLE_EMPTY * rentLamports.value)
const feeLamports = computed(() => Math.floor((recoveredLamports.value * fee.value) / 100))
const netLamports = computed(() => recoveredLamports.value - feeLamports.value)

function sol(lamports: number) {
  return Number((lamports / 1e9).toFixed(9))
}

const scanResponse = computed(() => `{
  "address": "WALLET_ADDRESS",
  "estimate": {
    "addr": "WALLET_ADDRESS",
    "empty": ${EXAMPLE_EMPTY},
    "dust": 2,
    "nft": 0,
    "frozen": 0,
    "keep": 1,
    "rent": ${rentSol.value},
    "dustValue": 0.0004,
    "noSol": false,
    "sol": 0.05,
    "emptySol": ${sol(recoveredLamports.value)},
    "dustSol": ${sol(2 * rentLamports.value)},
    "nftSol": 0,
    "solUsd": ${Number((cfg.value.solUsd || 0).toFixed(2))},
    "sweep": 1,
    "excess": 0,
    "excessSol": 0
  },
  "boxes": [
    {
      "address": "TOKEN_ACCOUNT",
      "mint": "MINT_ADDRESS",
      "program": "token",
      "amount": "0",
      "decimals": 6,
      "lamports": ${rentLamports.value},
      "extraLamports": 0,
      "space": 165,
      "excessLamports": 0,
      "frozen": false,
      "native": false,
      "delegate": "",
      "extensions": [],
      "symbol": "",
      "logo": "",
      "usdPrice": 0,
      "valueUsd": 0,
      "liquidityUsd": 0,
      "hasPrice": false,
      "listed": false,
      "netValueUsd": 0,
      "transferFeeBps": 0,
      "sweepable": false,
      "collection": "",
      "collectionVerified": false,
      "nftBurnable": false,
      "tokenStandard": null,
      "ruleSet": "",
      "kind": "empty"
    }
    // …one object per token account
  ],
  "rentNow": ${rentSol.value}
}`)

const planResponse = computed(() => `{
  "planId": "PLAN_ID",
  "address": "WALLET_ADDRESS",
  "dest": "same",
  "destination": "WALLET_ADDRESS",
  "feePayer": "WALLET_ADDRESS",
  "needsTreasurySig": false,
  "feeLamports": ${feeLamports.value},
  "netLamports": ${netLamports.value},
  "recoveredLamports": ${recoveredLamports.value},
  "txs": [
    {
      "id": "MESSAGE_HASH_PREFIX",
      "type": "CLOSE",
      "tx": "UNSIGNED_TX_BASE64",
      "messageHash": "MESSAGE_BASE64",
      "description": {
        "closes": ${EXAMPLE_EMPTY},
        "burns": 0,
        "sweeps": 0,
        "nfts": 0,
        "refunds": 0,
        "closeAccounts": ["TOKEN_ACCOUNT_1", "…"],
        "burnAccounts": [],
        "sweepAccounts": [],
        "sinkAtas": [],
        "nftAccounts": [],
        "nftMetas": [],
        "nftEditions": [],
        "refundAccounts": [],
        "closeDestination": "WALLET_ADDRESS",
        "feeTo": "GRABSTER_TREASURY",
        "feeLamports": ${feeLamports.value},
        "recoveredLamports": ${recoveredLamports.value}
      }
    }
  ]
}`)

const submitResponse = `{
  "signatures": ["TX_SIGNATURE_1"]
}`

const expiredResponse = `HTTP/1.1 409 Conflict

{
  "error": "Plan expired. Build it again.",
  "code": "blockhash_expired",
  "signatures": []
}`

const batchResponse = computed(() => `{
  "rows": [
    {
      "address": "WALLET_ADDRESS_1",
      "estimate": {
        "addr": "WALLET_ADDRESS_1",
        "empty": ${EXAMPLE_EMPTY},
        "emptySol": ${sol(recoveredLamports.value)},
        "noSol": false
        // …same fields as a single scan
      }
    },
    {
      "address": "WALLET_ADDRESS_2",
      "estimate": {
        "addr": "WALLET_ADDRESS_2",
        "empty": 0,
        "emptySol": 0,
        "noSol": true
        // …
      }
    },
    {
      "address": "not-a-wallet",
      "estimate": { "addr": "not-a-wallet", "empty": 0 /* …all zero */ },
      "error": "Invalid Solana address."
    }
  ]
}`)

const gasPerTxSol = computed(() => fmt(cfg.value.gas * 2, 6))

const SCAN_FIELDS = [
  { name: 'estimate.empty', note: 'Empty token accounts that can be closed.' },
  { name: 'estimate.emptySol', note: 'SOL locked in them (rent).' },
  { name: 'estimate.dust · dustSol', note: 'Accounts with small token balances, and their rent. Closing them needs a burn or a sweep.' },
  { name: 'estimate.nft · nftSol', note: 'NFT accounts, and the SOL they hold. It comes back only if the NFT is burned.' },
  { name: 'estimate.excess · excessSol', note: 'Accounts that stay open but hold more rent than the minimum, and that extra SOL. 0 when it is too small to be worth a transaction.' },
  { name: 'estimate.sol', note: 'SOL on the wallet now.' },
  { name: 'estimate.noSol', note: 'true when the wallet can\'t cover network fees on its own.' },
  { name: 'boxes[]', note: 'One object per token account, with kind, lamports, mint and price data.' },
  { name: 'rentNow', note: 'Rent for a standard token account today, in SOL.' },
]

const PLAN_PARAMS = computed(() => [
  { name: 'address', type: 'string', req: 'yes', note: 'The wallet that owns the token accounts. It signs every transaction.' },
  { name: 'dest', type: '"same" | "other"', req: 'yes', note: 'Where the recovered SOL ends up. "balance" is not available on the partner API.' },
  { name: 'other', type: 'string', req: 'if dest is "other"', note: 'Recipient address. Cannot be the Grabster treasury.' },
  { name: 'burnDust', type: 'boolean', req: 'no', note: 'Burn small token balances, then close those accounts. Narrow it with burnAccounts.' },
  { name: 'burnAccounts', type: 'string[]', req: 'no', note: 'Only these token accounts are burned when burnDust is true.' },
  { name: 'sweepAccounts', type: 'string[]', req: 'no', note: 'Give these leftovers to Grabster for a SOL credit. Cannot be combined with burnDust.', flag: cfg.value.features.sweep },
  { name: 'burnNft', type: 'boolean', req: 'no', note: 'Burn NFTs Grabster marks as burnable. Narrow it with nftAccounts.', flag: cfg.value.features.nftBurn },
  { name: 'nftAccounts', type: 'string[]', req: 'no', note: 'Only these NFT token accounts are burned.' },
  { name: 'refundExcess', type: 'boolean', req: 'no', note: 'Withdraw rent above the minimum from accounts that stay open. Narrow it with refundAccounts.', flag: cfg.value.features.excessRent },
  { name: 'refundAccounts', type: 'string[]', req: 'no', note: 'Only these accounts are refunded.' },
])

const PLAN_FIELDS = computed(() => [
  { name: 'planId', note: limits.value ? `Pass it to submit within ${limits.value.planTtlSec} s.` : 'Pass it to submit. Plans expire quickly.' },
  { name: 'txs[].tx', note: 'Base64 unsigned legacy transaction. The owner signs it.' },
  { name: 'txs[].description', note: 'What that transaction does: accounts closed or burned, closeDestination, feeTo, feeLamports, recoveredLamports.' },
  { name: 'recoveredLamports', note: 'Rent the plan releases.' },
  { name: 'feeLamports', note: 'Total sent to the Grabster treasury: the fee, plus withheld network fees when the treasury pays them.' },
  { name: 'netLamports', note: 'What reaches destination.' },
  { name: 'feePayer', note: 'Who pays Solana network fees: the wallet, or the Grabster treasury.' },
  { name: 'needsTreasurySig', note: 'true when the treasury also signs. The server adds that signature at submit.' },
])

const ERRORS = computed(() => [
  {
    code: '400',
    when: 'The body or address fails validation; "Nothing to grab."; "Not enough SOL to pay network fees."; an optional operation is switched off on this server; the signed transactions do not match the plan (count or content).',
  },
  {
    code: '400',
    when: 'The body has a top-level key named secret, privateKey, private_key, mnemonic, seed, keypair, feeToPubkey, feeTo or feePayer. Private keys and fee recipients are never accepted.',
  },
  { code: '401', when: '"Missing partner API key." or "Invalid partner API key."' },
  {
    code: '409',
    when: `code: "blockhash_expired". The plan is older than ${limits.value ? `${limits.value.planTtlSec} s` : 'its lifetime'}, or the network blockhash expired while sending. signatures lists anything already sent. Build a new plan and sign again.`,
  },
  {
    code: '429',
    when: `"Rate limit exceeded."${limits.value ? ` More than ${limits.value.partnerPerMin} requests in 60 s on one key.` : ''} Retry-After says how many seconds to wait.`,
  },
  { code: '502', when: '"Could not reach the Solana RPC. Try again in a moment."' },
  { code: '503', when: 'Only with sweepAccounts: "Grabster cannot take leftovers right now."' },
  { code: '500', when: 'Anything unexpected — including a plan the server refuses to return because its fee would not go to the Grabster treasury.' },
])

/* ---------- Try it ---------- */

type Mode = 'scan' | 'plan' | 'submit'
const MODES: { id: Mode; label: string }[] = [
  { id: 'scan', label: 'Scan' },
  { id: 'plan', label: 'Plan' },
  { id: 'submit', label: 'Submit' },
]

const mode = ref<Mode>('scan')
const scanAddress = ref('')
const planBody = ref(JSON.stringify({ address: 'WALLET_ADDRESS', dest: 'same' }, null, 2))
const submitBody = ref(JSON.stringify({ planId: 'PLAN_ID_FROM_PLAN', txs: ['SIGNED_TRANSACTION_BASE64'] }, null, 2))
const sending = ref(false)
const httpStatus = ref<number | null>(null)
const responseText = ref('')

const tryUrl = computed(() => {
  if (mode.value === 'scan') {
    const address = scanAddress.value.trim() || 'WALLET_ADDRESS'
    return `${apiOrigin}/v1/partner/scan/${encodeURIComponent(address)}`
  }
  if (mode.value === 'plan') return `${apiOrigin}/v1/partner/plan`
  return `${apiOrigin}/v1/partner/submit`
})

const modeHelp = computed(() => {
  if (mode.value === 'scan') return 'No body. The address goes in the URL. estimate.empty is the number of empty token accounts; estimate.emptySol is the SOL locked in them.'
  if (mode.value === 'plan') return 'dest "same" returns the SOL to that wallet; "other" plus "other": ADDRESS sends it elsewhere. Every txs[].tx is unsigned — the owner signs it, not you.'
  return 'planId comes from Plan. txs is that list after the owner signed each transaction, in the same order. The answer lists the on-chain signatures.'
})

const statusState = computed(() => {
  if (sending.value) return 'wait'
  if (httpStatus.value === null) return 'none'
  return httpStatus.value === 0 || httpStatus.value >= 400 ? 'bad' : 'ok'
})

const statusLabel = computed(() => {
  if (sending.value) return 'Sending'
  if (httpStatus.value === null) return 'No request yet'
  if (httpStatus.value === 0) return 'Not sent'
  return `HTTP ${httpStatus.value}`
})

const follow = computed(() => {
  if (httpStatus.value == null || httpStatus.value === 0 || httpStatus.value >= 400) return ''
  let parsed: { planId?: unknown; estimate?: unknown } | null = null
  try { parsed = JSON.parse(responseText.value) as { planId?: unknown; estimate?: unknown } } catch { return '' }
  if (mode.value === 'scan' && parsed && typeof parsed === 'object' && parsed.estimate) return 'Build a plan for this wallet'
  if (mode.value === 'plan' && parsed && typeof parsed.planId === 'string') return 'Put this planId into Submit'
  return ''
})

watch(() => auth.address, (address) => {
  if (address && !scanAddress.value) scanAddress.value = address
}, { immediate: true })

function pickMode(next: Mode) {
  mode.value = next
}

function onTabKey(e: KeyboardEvent) {
  const i = MODES.findIndex((m) => m.id === mode.value)
  let next = -1
  if (e.key === 'ArrowRight') next = (i + 1) % MODES.length
  else if (e.key === 'ArrowLeft') next = (i - 1 + MODES.length) % MODES.length
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = MODES.length - 1
  if (next < 0) return
  e.preventDefault()
  mode.value = MODES[next].id
  document.getElementById(`try-tab-${MODES[next].id}`)?.focus()
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    ui.showToast('Copied')
  } catch {
    ui.showToast('Copy is blocked in this browser')
  }
}

function useFollow() {
  if (mode.value === 'scan') {
    const address = scanAddress.value.trim()
    if (address) planBody.value = JSON.stringify({ address, dest: 'same' }, null, 2)
    mode.value = 'plan'
    return
  }
  try {
    const parsed = JSON.parse(responseText.value) as { planId?: unknown }
    if (typeof parsed.planId === 'string') {
      submitBody.value = JSON.stringify({ planId: parsed.planId, txs: ['SIGNED_TRANSACTION_BASE64'] }, null, 2)
    }
  } catch { /* the button only shows for JSON */ }
  mode.value = 'submit'
}

async function send() {
  if (!apiKey.value || sending.value) return
  httpStatus.value = null
  responseText.value = ''
  let body = ''
  if (mode.value === 'scan') {
    if (!scanAddress.value.trim()) {
      responseText.value = 'Put a wallet address in the field above.'
      httpStatus.value = 0
      return
    }
  } else {
    body = mode.value === 'plan' ? planBody.value : submitBody.value
    try { JSON.parse(body) } catch {
      responseText.value = 'The body is not valid JSON.'
      httpStatus.value = 0
      return
    }
  }
  sending.value = true
  try {
    const res = await fetch(tryUrl.value, {
      method: mode.value === 'scan' ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.value}`,
        ...(mode.value === 'scan' ? {} : { 'Content-Type': 'application/json' }),
      },
      body: mode.value === 'scan' ? undefined : body,
    })
    const text = await res.text()
    httpStatus.value = res.status
    try { responseText.value = JSON.stringify(JSON.parse(text), null, 2) } catch { responseText.value = text || res.statusText }
  } catch (e) {
    httpStatus.value = 0
    responseText.value = e instanceof Error ? e.message : 'Could not reach the API.'
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <section class="screen api">
    <header class="page-head">
      <h1>Reclaim rent from your own product.</h1>
      <p class="lede">
        Scan Solana wallets, build unsigned reclaim transactions, and broadcast them after the owner signs.
        Embed it in a wallet, bot, dashboard or backend. Grabster never asks for a private key.
      </p>

      <div class="split head-grid">
        <dl class="head-list">
          <div>
            <dt>What you can embed</dt>
            <dd>A wallet scan (one address or a batch), an unsigned plan that closes empty token accounts, and a submit call for the owner-signed transactions.</dd>
          </div>
          <div>
            <dt>How to get the key</dt>
            <dd>
              Sign in with a wallet — the key appears <router-link class="link" :to="{ hash: '#key' }">below</router-link>
              and in <router-link class="link" to="/profile/api-key">Profile → API key</router-link>.
            </dd>
          </div>
          <div>
            <dt>What it costs</dt>
            <dd>
              Free access: no subscription, no per-request charge. Each plan carries the Grabster fee —
              {{ fee }}% of recovered rent, a transfer inside its transactions. Solana network fees apply.
            </dd>
          </div>
        </dl>

        <div>
          <div class="code-block head-code">
            <div class="code-head">
              <span>Minimal example · scan one wallet</span>
              <button class="btn btn-sm btn-ghost" type="button" @click="copy(minimalCopy)">Copy</button>
            </div>
            <pre class="code">{{ minimalShown }}</pre>
            <p class="hint">
              Returns the empty token accounts and the SOL locked in them.
              <template v-if="apiKey"> Copy includes your full key.</template>
            </p>
          </div>
        </div>
      </div>
    </header>

    <!-- 01 Capabilities & terms -->
    <section class="page-section" aria-labelledby="terms-title">
      <p class="kicker"><span>01</span>Capabilities and free access</p>
      <div class="split">
        <div>
          <h2 id="terms-title">What the API does, and what it costs.</h2>
          <p class="lede small-lede">
            Free means free access: no subscription and no charge per request. Plans still carry the Grabster fee, and every key has a rate limit.
            Every plan shows its fee before anyone signs.
          </p>
        </div>
        <div>
          <dl class="kv">
            <div><dt>Access</dt><dd>Free · no subscription · no per-request charge</dd></div>
            <div><dt>Grabster fee</dt><dd>{{ fee }}% of recovered rent, inside each plan</dd></div>
            <div><dt>Network fees</dt><dd>Solana fees, paid by the wallet<template v-if="cfg.treasuryPaysGas"> — or by Grabster and withheld from the payout</template></dd></div>
            <template v-if="limits">
              <div><dt>Rate limit</dt><dd>{{ limits.partnerPerMin }} requests / minute / key</dd></div>
              <div><dt>Batch scan</dt><dd>up to {{ limits.partnerBatch }} addresses per call</dd></div>
              <div><dt>Plan lifetime</dt><dd>{{ limits.planTtlSec }} s</dd></div>
            </template>
            <div><dt>Version</dt><dd>all endpoints under /v1</dd></div>
          </dl>
          <div class="tscroll caps">
            <table class="table">
              <thead><tr><th scope="col">Endpoint</th><th scope="col">Does</th></tr></thead>
              <tbody>
                <tr><td class="mono">GET /v1/partner/scan/{address}</td><td>Scan one wallet</td></tr>
                <tr><td class="mono">POST /v1/partner/scan</td><td>Scan a batch<template v-if="limits"> (≤ {{ limits.partnerBatch }})</template></td></tr>
                <tr><td class="mono">POST /v1/partner/plan</td><td>Build unsigned transactions</td></tr>
                <tr><td class="mono">POST /v1/partner/submit</td><td>Broadcast owner-signed transactions</td></tr>
                <tr><td class="mono">GET /v1/partner/me</td><td>Check that a key works</td></tr>
                <tr><td class="mono">GET /v1/partner/openapi.yaml</td><td>OpenAPI 3 spec, no key needed</td></tr>
              </tbody>
            </table>
          </div>
          <p class="hint">
            Not part of this API: Grabster balance, referrals and withdrawals. Referral links don't apply to API cleanups.
            <a class="link" :href="specUrl" target="_blank" rel="noopener">Open the OpenAPI spec</a>
          </p>
        </div>
      </div>
    </section>

    <!-- 02 Key -->
    <section id="key" class="page-section" aria-labelledby="key-title">
      <p class="kicker"><span>02</span>Get a key</p>
      <div class="split">
        <div>
          <h2 id="key-title">One key per wallet.</h2>
          <p class="lede small-lede">
            Sign in with a wallet and Grabster creates a key for it. The same key works for the API and MCP.
            You'll also find it in <router-link class="link" to="/profile/api-key">Profile → API key</router-link>.
          </p>
          <p class="hint">
            Creating or replacing a key uses your site session, not the key itself
            (<code class="inline">GET /v1/partner/key</code>, <code class="inline">POST /v1/partner/key/rotate</code>).
          </p>
        </div>
        <PartnerKeyBox @key="onKey" />
      </div>
    </section>

    <!-- 03 Quick start -->
    <section class="page-section" aria-labelledby="qs-title">
      <p class="kicker"><span>03</span>Quick start</p>
      <h2 id="qs-title" class="section-title">Scan, plan, owner signs, submit.</h2>
      <ol class="flow" aria-label="API flow">
        <li><span class="mono">01</span>Scan</li>
        <li><span class="mono">02</span>Plan (unsigned)</li>
        <li><span class="mono">03</span>Owner signs</li>
        <li><span class="mono">04</span>Submit</li>
      </ol>
      <ol class="steps-list">
        <li>
          <b>Scan the wallet</b>
          <p>
            Run the minimal example above. Read <code class="inline">estimate.empty</code> (empty token accounts) and
            <code class="inline">estimate.emptySol</code> (SOL locked in them). <code class="inline">estimate.noSol</code> is
            true when the wallet can't cover network fees on its own.
          </p>
        </li>
        <li>
          <b>Build a plan</b>
          <p>The response holds unsigned transactions and the exact fee. Nothing is sent yet.</p>
          <div class="code-block">
            <div class="code-head"><span>POST /v1/partner/plan</span><button class="btn btn-sm btn-ghost" type="button" @click="copy(planCurl)">Copy</button></div>
            <pre class="code">{{ planCurl }}</pre>
          </div>
        </li>
        <li>
          <b>The owner signs</b>
          <p>
            Signing happens in the owner's wallet, on their side. Keep the order of <code class="inline">txs</code>.
            Serialize with <code class="inline">requireAllSignatures: false</code> — needed when the treasury also signs.
          </p>
          <div class="code-block">
            <div class="code-head"><span>JavaScript · @solana/web3.js</span><button class="btn btn-sm btn-ghost" type="button" @click="copy(signSnippet)">Copy</button></div>
            <pre class="code">{{ signSnippet }}</pre>
          </div>
        </li>
        <li>
          <b>Submit</b>
          <p>Send the signed transactions with the planId<template v-if="limits">, within {{ limits.planTtlSec }} seconds of building the plan</template>.</p>
          <div class="code-block">
            <div class="code-head"><span>POST /v1/partner/submit</span><button class="btn btn-sm btn-ghost" type="button" @click="copy(submitCurl)">Copy</button></div>
            <pre class="code">{{ submitCurl }}</pre>
          </div>
        </li>
      </ol>
    </section>

    <!-- 04 Reference -->
    <section class="page-section" aria-labelledby="ref-title">
      <p class="kicker"><span>04</span>Scan / Plan / Submit</p>
      <h2 id="ref-title" class="section-title">Requests and responses.</h2>
      <p class="hint ref-note">
        Field names match what the API returns. Values are examples: uppercase strings are placeholders, and the lamport
        amounts are {{ EXAMPLE_EMPTY }} empty accounts at today's rent with the {{ fee }}% fee.
      </p>

      <article class="endpoint" aria-labelledby="ep-scan">
        <header class="ep-head">
          <span class="badge solid">GET</span>
          <h3 id="ep-scan" class="mono">/v1/partner/scan/{address}</h3>
        </header>
        <div class="ep-grid">
          <div class="ep-main">
            <p class="ep-desc">
              Reads public chain data for one wallet. No signature, no private key. Each token account in
              <code class="inline">boxes</code> is classified by <code class="inline">kind</code>: <span class="mono">empty</span>,
              <span class="mono">dust</span>, <span class="mono">nft</span>, <span class="mono">frozen</span> or
              <span class="mono">keep</span>. An invalid address returns 400.
            </p>
            <div class="tscroll">
              <table class="table">
                <caption class="sr-only">Scan response fields</caption>
                <thead><tr><th scope="col">Field</th><th scope="col">Meaning</th></tr></thead>
                <tbody>
                  <tr v-for="f in SCAN_FIELDS" :key="f.name"><td class="mono">{{ f.name }}</td><td>{{ f.note }}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="code-block">
            <div class="code-head"><span>Response 200 · example</span></div>
            <pre class="code tall">{{ scanResponse }}</pre>
          </div>
        </div>
      </article>

      <article class="endpoint" aria-labelledby="ep-plan">
        <header class="ep-head">
          <span class="badge solid">POST</span>
          <h3 id="ep-plan" class="mono">/v1/partner/plan</h3>
        </header>
        <p class="ep-desc">
          Builds unsigned legacy transactions for one wallet. Leave the optional fields out to only close empty token
          accounts. The fee recipient is fixed by the server: <code class="inline">feeTo</code> is always the Grabster
          treasury — the same address as <code class="inline">treasury</code> in <code class="inline">GET /v1/config</code>.
        </p>
        <div class="tscroll">
          <table class="table params">
            <caption class="sr-only">Plan request body</caption>
            <thead><tr><th scope="col">Field</th><th scope="col">Type</th><th scope="col">Required</th><th scope="col">Meaning</th></tr></thead>
            <tbody>
              <tr v-for="p in PLAN_PARAMS" :key="p.name">
                <td class="mono">{{ p.name }}</td>
                <td class="mono muted">{{ p.type }}</td>
                <td class="muted">{{ p.req }}</td>
                <td>
                  {{ p.note }}
                  <span v-if="p.flag !== undefined" class="badge" :class="{ accent: p.flag }">{{ p.flag ? 'on here' : 'off here' }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="ep-grid">
          <div class="tscroll ep-main">
            <table class="table">
              <caption class="sr-only">Plan response fields</caption>
              <thead><tr><th scope="col">Response field</th><th scope="col">Meaning</th></tr></thead>
              <tbody>
                <tr v-for="f in PLAN_FIELDS" :key="f.name"><td class="mono">{{ f.name }}</td><td>{{ f.note }}</td></tr>
              </tbody>
            </table>
          </div>
          <div class="code-block">
            <div class="code-head"><span>Response 200 · example</span></div>
            <pre class="code tall">{{ planResponse }}</pre>
          </div>
        </div>

        <div class="notes">
          <div>
            <h4>Who pays network fees</h4>
            <p>
              Normally the wallet does: <code class="inline">feePayer</code> is the wallet address, and it needs enough SOL for the
              fees plus its rent-exempt minimum.
            </p>
            <p v-if="cfg.treasuryPaysGas">
              When it doesn't have that, the plan sets <code class="inline">feePayer</code> to the Grabster treasury and
              <code class="inline">needsTreasurySig: true</code>. Each transaction then also withholds {{ gasPerTxSol }} SOL
              (2 × the {{ fmt(cfg.gas, 6) }} SOL network-fee estimate) for the treasury, on top of the {{ fee }}% fee. Both are counted in
              <code class="inline">feeLamports</code>, capped at the rent that transaction recovers.
            </p>
            <p v-else>
              On this server Grabster doesn't pay network fees: a wallet without enough SOL gets
              <code class="inline">400 Not enough SOL to pay network fees.</code>
            </p>
          </div>
          <div>
            <h4>Plans expire</h4>
            <p>
              A plan uses a recent blockhash and is kept for
              <template v-if="limits">{{ limits.planTtlSec }} seconds</template><template v-else>a short time</template>.
              Build it right before the owner signs. If submit answers <code class="inline">409</code> with
              <code class="inline">code: "blockhash_expired"</code>, build a new plan and sign again — a fresh plan only contains
              what is still left on the wallet.
            </p>
          </div>
        </div>
      </article>

      <article class="endpoint" aria-labelledby="ep-submit">
        <header class="ep-head">
          <span class="badge solid">POST</span>
          <h3 id="ep-submit" class="mono">/v1/partner/submit</h3>
        </header>
        <p class="ep-desc">
          Body: <code class="inline">planId</code> and <code class="inline">txs</code> — the plan's transactions after the owner signed
          them, base64, same count and order. Before broadcasting anything the server decodes every transaction and checks it against
          the plan: allowed programs, the accounts closed or burned, where SOL goes and how much reaches the treasury. Any mismatch
          rejects the whole submit with 400 and nothing is sent. If <code class="inline">needsTreasurySig</code> is true, the server adds
          the treasury signature, then sends the transactions in order.
        </p>
        <div class="pair">
          <div class="code-block">
            <div class="code-head"><span>Response 200</span></div>
            <pre class="code">{{ submitResponse }}</pre>
          </div>
          <div class="code-block">
            <div class="code-head"><span>Plan expired</span></div>
            <pre class="code">{{ expiredResponse }}</pre>
          </div>
        </div>
        <p class="hint">
          If sending stops part-way (409 when the blockhash expired, or another error), the error body's
          <code class="inline">signatures</code> lists the transactions that were already sent. Treat them as possibly landed: check
          their status, then rebuild the plan — it is built from fresh chain data, so it only covers what is left.
        </p>
      </article>
    </section>

    <!-- 05 Batch -->
    <section class="page-section" aria-labelledby="batch-title">
      <p class="kicker"><span>05</span>Batch</p>
      <div class="split">
        <div>
          <h2 id="batch-title">Many wallets: batch scan, then one plan per wallet.</h2>
          <p class="lede small-lede">
            <code class="inline">POST /v1/partner/scan</code> checks<template v-if="limits"> up to {{ limits.partnerBatch }}</template>
            addresses in one call. Duplicates are dropped, and an invalid address comes back as a row with
            <code class="inline">error</code> and a zeroed estimate. Batch rows have no <code class="inline">boxes</code>.
          </p>
          <p class="lede small-lede">
            Plans and submits stay per wallet: each owner signs their own transactions. There is no batch plan endpoint.
            A wallet with many accounts gets several transactions in one plan.
          </p>
          <p v-if="limits" class="hint">
            Every scan, plan and submit is one request against the {{ limits.partnerPerMin }}/minute limit.
          </p>
        </div>
        <div class="stack">
          <div class="code-block">
            <div class="code-head"><span>POST /v1/partner/scan</span><button class="btn btn-sm btn-ghost" type="button" @click="copy(batchCurl)">Copy</button></div>
            <pre class="code">{{ batchCurl }}</pre>
          </div>
          <div class="code-block">
            <div class="code-head"><span>Response 200 · example</span></div>
            <pre class="code">{{ batchResponse }}</pre>
          </div>
          <div class="code-block">
            <div class="code-head"><span>Loop · pseudocode</span><button class="btn btn-sm btn-ghost" type="button" @click="copy(batchLoop)">Copy</button></div>
            <pre class="code">{{ batchLoop }}</pre>
          </div>
        </div>
      </div>
    </section>

    <!-- 06 Fees, limits & errors -->
    <section class="page-section" aria-labelledby="errors-title">
      <p class="kicker"><span>06</span>Fees, limits and errors</p>
      <h2 id="errors-title" class="section-title">What the server enforces.</h2>
      <div class="stats-row limits">
        <div><b>{{ fee }}%</b><small>Grabster fee, inside each plan</small></div>
        <template v-if="limits">
          <div><b>{{ limits.partnerPerMin }}</b><small>Requests / min / key</small></div>
          <div><b>{{ limits.partnerBatch }}</b><small>Addresses per batch scan</small></div>
          <div><b>{{ limits.planTtlSec }} s</b><small>Plan lifetime</small></div>
        </template>
      </div>
      <p class="hint">
        Authenticated responses carry <code class="inline">X-RateLimit-Limit</code> and <code class="inline">X-RateLimit-Remaining</code>.
        The window is the last 60 seconds per key. Errors have the body
        <code class="inline">{ "error": "…", "code"?: "…", "signatures"?: [] }</code>.
      </p>
      <div class="tscroll errors">
        <table class="table">
          <caption class="sr-only">HTTP status codes</caption>
          <thead><tr><th scope="col">Status</th><th scope="col">When</th></tr></thead>
          <tbody>
            <tr v-for="(e, i) in ERRORS" :key="i">
              <td class="mono status-code">{{ e.code }}</td>
              <td>{{ e.when }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 07 Try it -->
    <section class="page-section" aria-labelledby="try-title">
      <p class="kicker"><span>07</span>Try it</p>
      <div class="split">
        <div>
          <h2 id="try-title">Call the API from this page.</h2>
          <p class="lede small-lede">
            Requests go to <span class="mono">{{ apiOrigin }}</span> with your key attached. Scan and Plan change nothing on chain.
            Submit broadcasts only transactions the owner already signed.
          </p>
          <p class="hint">
            Each request counts against your key's limit.
            <a class="link" :href="specUrl" target="_blank" rel="noopener">OpenAPI spec</a>
          </p>
        </div>

        <div class="try">
          <div class="tabs" role="tablist" aria-label="Request type" @keydown="onTabKey">
            <button
              v-for="m in MODES"
              :id="`try-tab-${m.id}`"
              :key="m.id"
              type="button"
              role="tab"
              :aria-selected="mode === m.id"
              :tabindex="mode === m.id ? 0 : -1"
              aria-controls="try-panel"
              :class="{ on: mode === m.id }"
              @click="pickMode(m.id)"
            >{{ m.label }}</button>
          </div>

          <div id="try-panel" class="try-panel" role="tabpanel" :aria-labelledby="`try-tab-${mode}`">
            <p class="muted try-help">{{ modeHelp }}</p>
            <p class="url"><span class="badge solid">{{ mode === 'scan' ? 'GET' : 'POST' }}</span><span class="mono">{{ tryUrl }}</span></p>

            <template v-if="mode === 'scan'">
              <label class="field-label" for="try-address">Wallet address</label>
              <input id="try-address" v-model="scanAddress" class="input" spellcheck="false" placeholder="Wallet address" autocomplete="off" />
            </template>
            <template v-else-if="mode === 'plan'">
              <label class="field-label" for="try-plan">Request body</label>
              <textarea id="try-plan" v-model="planBody" class="input body" spellcheck="false" />
            </template>
            <template v-else>
              <label class="field-label" for="try-submit">Request body</label>
              <textarea id="try-submit" v-model="submitBody" class="input body" spellcheck="false" />
            </template>

            <div class="try-actions">
              <button class="btn arrow" type="button" :disabled="sending || !apiKey" @click="send">{{ sending ? 'Sending…' : 'Send request' }}</button>
              <p v-if="!apiKey" class="muted">
                <template v-if="auth.address">Loading your key…</template>
                <template v-else>Sign in <router-link class="link" :to="{ hash: '#key' }">above</router-link> and your key is attached.</template>
              </p>
            </div>

            <div class="code-block result">
              <div class="code-head">
                <span>Response</span>
                <span class="status" :data-s="statusState" role="status" aria-live="polite">{{ statusLabel }}</span>
              </div>
              <pre class="code tall" aria-live="polite">{{ responseText || 'The response shows up here.' }}</pre>
            </div>
            <button v-if="follow" class="btn btn-sm btn-ghost arrow follow" type="button" @click="useFollow">{{ follow }}</button>
          </div>
        </div>
      </div>
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

/* "on here" tag: the shared purple text is too dim on the dark tint. */
.badge.accent { color: var(--accent-2); }
:root[data-theme='dark'] .badge.accent { color: var(--accent-text); }

.head-list {
  margin: 0;
  border-top: 1px solid var(--line-2);

  > div {
    padding: 16px 0;
    border-bottom: 1px solid var(--line-2);
  }

  dt {
    font-weight: 600;
    font-size: 18px;
    letter-spacing: -0.02em;
    color: var(--ink);
  }

  dd {
    margin: 6px 0 0;
    color: var(--ink-2);
    font-size: 15px;
  }
}

.split .lede { margin-top: 24px; }

.small-lede { font-size: 17px; line-height: 1.45; }

.kv dd { text-align: right; }

.caps { margin-top: 32px; }

/* The four steps as cells on one rule, read left to right. */
.flow {
  list-style: none;
  margin: 0 0 40px;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border: 1px solid var(--line-2);

  li {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 24px;
    min-height: 120px;
    padding: 16px 18px;
    font-size: clamp(18px, 1.8vw, 26px);
    font-weight: 500;
    letter-spacing: -0.02em;
    line-height: 1.1;
    border-left: 1px solid var(--line-2);
    position: relative;

    &:first-child { border-left: 0; }

    .mono { order: -1; font-size: 12px; letter-spacing: 0; color: var(--muted); font-weight: 400; }
  }

  @media (max-width: 760px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));

    li { min-height: 96px; }
    li:nth-child(3) { border-left: 0; }
    li:nth-child(n + 3) { border-top: 1px solid var(--line-2); }
  }
}

.steps-list .code-block { margin-top: 14px; }

.steps-list code.inline,
.ep-desc code.inline,
.notes code.inline,
.lede code.inline,
.hint code.inline { white-space: normal; overflow-wrap: break-word; }

pre.code.tall {
  max-height: 520px;
  overflow: auto;
}

.ref-note { margin: -16px 0 32px; }

/* Each endpoint is its own band across the page. */
.endpoint {
  display: grid;
  gap: 20px;
  margin: 0 calc(-1 * var(--gutter));
  padding: 32px var(--gutter) 48px;
  border-top: 1px solid var(--line-2);
  min-width: 0;

  &:last-child { padding-bottom: 0; }
}

.ep-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;

  .badge { font-size: 12px; padding: 5px 9px; }

  h3 {
    font-family: var(--mono);
    font-weight: 500;
    font-size: clamp(18px, 2vw, 26px);
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
  }
}

.ep-desc {
  color: var(--ink-2);
  font-size: 16px;
  max-width: 78ch;
}

.ep-grid {
  display: grid;
  grid-template-columns: minmax(0, 6fr) minmax(0, 5fr);
  gap: 32px;
  align-items: start;

  > * { min-width: 0; }

  .ep-main { display: grid; gap: 20px; }

  @media (max-width: 960px) {
    grid-template-columns: 1fr;
    gap: 20px;
  }
}

.params td:first-child,
.params td:nth-child(2) { white-space: nowrap; }

.params td:last-child { min-width: 280px; }

.params .badge { margin-left: 6px; }

.notes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border: 1px solid var(--line-2);

  > div {
    padding: 20px 24px 24px;
    min-width: 0;

    & + div { border-left: 1px solid var(--line-2); }
  }

  h4 { margin: 0 0 10px; }

  p {
    color: var(--ink-2);
    font-size: 15px;

    & + p { margin-top: 10px; }
  }

  @media (max-width: 760px) {
    grid-template-columns: 1fr;

    > div { padding: 18px; }

    > div + div {
      border-left: 0;
      border-top: 1px solid var(--line-2);
    }
  }
}

.pair {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;

  @media (max-width: 760px) { grid-template-columns: 1fr; }
}

.stack {
  display: grid;
  gap: 16px;
  min-width: 0;
  align-content: start;
}

.limits { margin-bottom: 20px; }

.errors { margin-top: 28px; }

.status-code {
  width: 72px;
  color: var(--ink);
}

.try { min-width: 0; }

.try-panel { padding-top: 24px; }

.try-help { font-size: 15px; }

.url {
  display: flex;
  align-items: stretch;
  margin: 16px 0 20px;
  font-size: 13px;
  min-width: 0;
  border: 1px solid var(--line-2);
  background: var(--field);

  .badge { display: flex; align-items: center; padding: 0 10px; }
  .mono { padding: 10px 12px; overflow-wrap: anywhere; color: var(--ink); min-width: 0; }
}

textarea.input.body {
  min-height: 160px;
  white-space: pre;
  overflow-wrap: normal;
  word-break: normal;
  overflow-x: auto;
}

.try-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px 16px;
  margin-top: 16px;

  .btn { min-height: 52px; min-width: 200px; }
  p { font-size: 14px; }
}

.result { margin-top: 20px; }

.follow { margin-top: 14px; }
</style>
