import './style.css'
import { Connection, Keypair, Transaction } from '@solana/web3.js'
import {
  ESTIMATED_GAS_SOL,
  b64ToBytes,
  bytesToB64,
  canRefundExcess,
  classifyInput,
  fmt,
  inspectPlan,
  lamportsToSol,
  planLocal,
  scanLocal,
  secretFromRaw,
  short,
  solToLamports,
  type PlanResponse,
  type ScanResponse,
  type TokenBox,
} from '@grabster/solana-core'

function feePercent(raw: string): number {
  if (!raw.trim()) return 1
  const n = Number(raw)
  if (!Number.isFinite(n)) return 1
  return Math.min(100, Math.max(0, n))
}

const FEE_PERCENT = feePercent(__GRABSTER_FEE_PERCENT__)
const TREASURY = __GRABSTER_TREASURY__.trim()

interface InjectedProvider {
  isPhantom?: boolean
  isSolflare?: boolean
  publicKey?: { toString(): string } | string | null
  connect: () => Promise<{ publicKey?: { toString(): string } | string | null } | boolean | undefined>
  disconnect?: () => Promise<void>
  on?: (event: string, cb: (...args: unknown[]) => void) => void
  off?: (event: string, cb: (...args: unknown[]) => void) => void
  signTransaction?: (tx: Transaction) => Promise<Transaction>
  signAllTransactions?: (txs: Transaction[]) => Promise<Transaction[]>
}

const rpcEl = document.querySelector<HTMLInputElement>('#rpc')!
const addressEl = document.querySelector<HTMLInputElement>('#address')!
const keyEl = document.querySelector<HTMLInputElement>('#key')!
const errorEl = document.querySelector<HTMLParagraphElement>('#error')!
const reviewErrorEl = document.querySelector<HTMLParagraphElement>('#review-error')!
const sendErrorEl = document.querySelector<HTMLParagraphElement>('#send-error')!
const walletNote = document.querySelector<HTMLParagraphElement>('#wallet-note')!
const resultsEl = document.querySelector<HTMLElement>('#results')!
const statSol = document.querySelector<HTMLElement>('#stat-sol')!
const statRent = document.querySelector<HTMLElement>('#stat-rent')!
const statEmpty = document.querySelector<HTMLElement>('#stat-empty')!
const scannedEl = document.querySelector<HTMLElement>('#scanned')!
const emptyLine = document.querySelector<HTMLParagraphElement>('#empty-line')!
const closeEmptyEl = document.querySelector<HTMLInputElement>('#close-empty')!
const dustEl = document.querySelector<HTMLUListElement>('#dust')!
const dustEmpty = document.querySelector<HTMLParagraphElement>('#dust-empty')!
const refundsEl = document.querySelector<HTMLUListElement>('#refunds')!
const refundEmpty = document.querySelector<HTMLParagraphElement>('#refund-empty')!
const untouchedEl = document.querySelector<HTMLUListElement>('#untouched')!
const planEl = document.querySelector<HTMLElement>('#plan')!
const receiptEl = document.querySelector<HTMLElement>('#receipt')!
const keysEl = document.querySelector<HTMLTextAreaElement>('#keys')!
const oneFields = document.querySelector<HTMLElement>('#one-fields')!
const listFields = document.querySelector<HTMLElement>('#list-fields')!
const batchEl = document.querySelector<HTMLElement>('#batch')!
const batchRows = document.querySelector<HTMLElement>('#batch-rows')!
const sendListEl = document.querySelector<HTMLButtonElement>('#send-list')!
const batchErrorEl = document.querySelector<HTMLParagraphElement>('#batch-error')!
const batchStatusEl = document.querySelector<HTMLParagraphElement>('#batch-status')!
const sendEl = document.querySelector<HTMLButtonElement>('#send')!
const statusEl = document.querySelector<HTMLParagraphElement>('#status')!
const sigsEl = document.querySelector<HTMLUListElement>('#sigs')!
const connectEl = document.querySelector<HTMLButtonElement>('#connect')!
const actionsEl = document.querySelector<HTMLDivElement>('.actions')!

interface BatchRow {
  address: string
  scan: ScanResponse
  plan: PlanResponse | null
  signatures: string[]
  error: string
}

let scan: ScanResponse | null = null
let plan: PlanResponse | null = null
let wallet: InjectedProvider | null = null
let sending = false
let batch: BatchRow[] = []
let batchSending = false

function clearErrors() {
  errorEl.textContent = ''
  reviewErrorEl.textContent = ''
  sendErrorEl.textContent = ''
  batchErrorEl.textContent = ''
}

function setError(message: string, where: 'scan' | 'review' | 'send' = 'scan') {
  clearErrors()
  const el = where === 'review' ? reviewErrorEl : where === 'send' ? sendErrorEl : errorEl
  el.textContent = message
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (message) el.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' })
}

function setStatus(message: string) {
  statusEl.textContent = message
}

function solText(lamports: number): string {
  return `${fmt(lamportsToSol(lamports), 9)} SOL`
}

function explorerTx(signature: string): string {
  return `https://solscan.io/tx/${signature}`
}

function explorerAccount(address: string): string {
  return `https://solscan.io/account/${address}`
}

/** One receipt row: <div><dt>label <small>note</small></dt><dd>value</dd></div>. */
function payBlock(label: string, value: string | HTMLElement, note = '', total = false): HTMLElement {
  const block = document.createElement('div')
  if (total) block.className = 'total'
  const k = document.createElement('dt')
  k.textContent = label
  if (note) {
    const small = document.createElement('small')
    small.textContent = note
    k.append(small)
  }
  const v = document.createElement('dd')
  v.append(value)
  block.append(k, v)
  return block
}

function addressLink(address: string): HTMLAnchorElement {
  const link = document.createElement('a')
  link.className = 'addr'
  link.href = explorerAccount(address)
  link.target = '_blank'
  link.rel = 'noreferrer'
  link.textContent = address
  return link
}

/** Same per-transaction budget the plan reserves for network fees. */
const GAS_PER_TX = solToLamports(ESTIMATED_GAS_SOL)

function minus(lamports: number): string {
  return lamports > 0 ? `− ${solText(lamports)}` : solText(0)
}

function accountsLine(row: PlanResponse): string {
  let closes = 0
  let burns = 0
  let refunds = 0
  for (const tx of row.txs) {
    closes += tx.description.closes
    burns += tx.description.burns
    refunds += tx.description.refunds
  }
  const bits: string[] = []
  if (closes - burns > 0) bits.push(`${closes - burns} closed`)
  if (burns) bits.push(`${burns} burned and closed`)
  if (refunds) bits.push(`${refunds} extra rent refunded`)
  return bits.join(' · ') || 'none'
}

function fillMoney(root: HTMLElement, row: PlanResponse, signatures: string[], compact = false) {
  root.replaceChildren()
  const gas = row.txs.length * GAS_PER_TX
  const money = document.createElement('dl')
  money.className = 'kv receipt'
  money.append(
    payBlock('Rent recovered', solText(row.recoveredLamports), 'Gross, before any fee'),
    payBlock(`Grabster fee · ${FEE_PERCENT}%`, minus(row.feeLamports), 'A transfer inside these transactions'),
    payBlock('Network fee, estimate', `up to ${solText(gas)}`, `${row.txs.length} × ${fmt(ESTIMATED_GAS_SOL, 4)} SOL budget. The network usually charges less`),
    payBlock('Estimated net to the wallet', `at least ${solText(row.netLamports - gas)}`, `${solText(row.netLamports)} before the network fee`, true),
  )
  root.append(money)

  const parties = document.createElement('dl')
  parties.className = 'kv parties'
  if (!compact) {
    const feeTo = row.txs.find((tx) => tx.description.feeTo)?.description.feeTo || ''
    parties.append(
      payBlock('Recipient', addressLink(row.destination), 'Rent returns here'),
      payBlock('Fee payer', addressLink(row.feePayer), 'Signs and pays the network fee'),
    )
    if (row.feeLamports > 0 && feeTo) parties.append(payBlock('Grabster fee to', addressLink(feeTo), 'Set when this file was built'))
  }
  parties.append(
    payBlock('Accounts', accountsLine(row)),
    payBlock('Transactions', String(row.txs.length), [...new Set(row.txs.map((tx) => tx.type.toLowerCase()))].join(', ')),
  )
  if (!compact) parties.append(payBlock('RPC', rpcHost() || 'not set', 'Simulates and sends'))

  if (signatures.length) {
    const links = document.createElement('span')
    links.className = 'sig-links'
    for (const signature of signatures) {
      const link = document.createElement('a')
      link.className = 'addr'
      link.href = explorerTx(signature)
      link.target = '_blank'
      link.rel = 'noreferrer'
      link.title = signature
      link.textContent = short(signature)
      links.append(link)
    }
    const sent = document.createElement('span')
    sent.className = 'status'
    sent.dataset.s = 'ok'
    sent.textContent = 'Sent'
    parties.append(
      payBlock('Result', sent),
      payBlock(signatures.length === 1 ? 'Signature' : 'Signatures', links, 'Opens Solscan'),
    )
  }
  root.append(parties)
}

function friendly(err: unknown): string {
  const message = err instanceof Error ? err.message : 'Something went wrong.'
  if (/failed to fetch|networkerror|fetch failed|load failed|cors/i.test(message)) {
    return 'Could not reach that RPC. Check the URL, and use an endpoint that allows browser requests.'
  }
  if (/403|access forbidden|401|api key|request blocked/i.test(message)) {
    return 'That RPC refused the browser. The Helius URL in the field is a working example.'
  }
  if (/user rejected|user declined|cancelled|canceled/i.test(message)) {
    return 'The wallet cancelled the signature.'
  }
  return message.length > 280 ? `${message.slice(0, 280)}…` : message
}

function rpcUrl(): string {
  let url: URL
  try {
    url = new URL(rpcEl.value.trim())
  } catch {
    throw new Error('Enter an RPC URL that starts with https:// or http://.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('RPC URL must start with https:// or http://.')
  }
  return url.toString()
}

/** Host of the RPC field for display. Never the path or query, so an api key is not echoed. */
function rpcHost(): string {
  try {
    const url = new URL(rpcEl.value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.host : ''
  } catch {
    return ''
  }
}

function showRpcHost() {
  const host = rpcHost()
  document.querySelectorAll<HTMLElement>('.rpc-host').forEach((el) => {
    el.textContent = host || 'not set'
  })
}

function connection(): Connection {
  return new Connection(rpcUrl(), 'confirmed')
}

function browserWallets(): { provider: InjectedProvider; label: string }[] {
  const root = window as unknown as {
    solana?: InjectedProvider & { providers?: InjectedProvider[] }
    solflare?: InjectedProvider
    phantom?: { solana?: InjectedProvider }
  }
  const found: { provider: InjectedProvider; label: string }[] = []
  const seen = new Set<InjectedProvider>()
  const add = (provider: InjectedProvider | undefined, label: string) => {
    if (!provider?.connect || seen.has(provider)) return
    seen.add(provider)
    found.push({ provider, label })
  }
  add(root.phantom?.solana || (root.solana?.isPhantom ? root.solana : undefined), 'Phantom')
  add(root.solflare, 'Solflare')
  for (const provider of root.solana?.providers || []) {
    add(provider, provider.isPhantom ? 'Phantom' : provider.isSolflare ? 'Solflare' : 'Wallet')
  }
  if (!found.length && root.solana) add(root.solana, walletLabel(root.solana))
  found.sort((a, b) => Number(b.label === 'Phantom') - Number(a.label === 'Phantom'))
  return found
}

function walletLabel(provider: InjectedProvider): string {
  if (provider.isPhantom) return 'Phantom'
  if (provider.isSolflare) return 'Solflare'
  return 'Wallet'
}

function keyText(key: unknown): string {
  if (!key) return ''
  if (typeof key === 'string') return key
  if (typeof key === 'object' && 'toString' in key && typeof key.toString === 'function') {
    const text = key.toString()
    return text && text !== '[object Object]' ? text : ''
  }
  return ''
}

function walletAddressOf(provider: InjectedProvider): string {
  return keyText(provider.publicKey)
}

function waitForWalletAddress(provider: InjectedProvider): Promise<string> {
  const ready = walletAddressOf(provider)
  if (ready) return Promise.resolve(ready)
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      const address = walletAddressOf(provider)
      if (!address) return
      settled = true
      provider.off?.('connect', finish)
      resolve(address)
    }
    provider.on?.('connect', finish)
    window.setTimeout(() => {
      if (settled) return
      settled = true
      provider.off?.('connect', finish)
      resolve(walletAddressOf(provider))
    }, 1500)
  })
}

function pullKeyOutOfAddress() {
  const classified = classifyInput(addressEl.value)
  if (classified.kind !== 'key') return
  keyEl.value = addressEl.value.trim()
  addressEl.value = classified.addr
}

function walletAddress(): string {
  pullKeyOutOfAddress()
  const typed = addressEl.value.trim()
  if (typed) {
    const classified = classifyInput(typed)
    if (classified.kind === 'address') return classified.addr
    throw new Error('That is not a Solana address.')
  }
  const connected = wallet ? walletAddressOf(wallet) : ''
  if (connected) {
    addressEl.value = connected
    return connected
  }
  const secret = secretFromRaw(keyEl.value.trim())
  if (!secret) throw new Error('Enter a wallet address, connect a wallet, or paste a private key.')
  const addr = Keypair.fromSecretKey(secret).publicKey.toBase58()
  secret.fill(0)
  addressEl.value = addr
  return addr
}

function checkedAddresses(list: HTMLUListElement): string[] {
  return Array.from(list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'))
    .map((input) => input.dataset.address || '')
    .filter(Boolean)
}

async function simulateUnsigned(rpc: Connection, tx: Transaction): Promise<void> {
  const raw = bytesToB64(tx.serialize({ requireAllSignatures: false, verifySignatures: false }))
  const res = await fetch(rpc.rpcEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'simulateTransaction',
      params: [raw, { encoding: 'base64', sigVerify: false, commitment: 'confirmed' }],
    }),
  })
  const body = await res.json() as { error?: { message?: string }; result?: { value?: { err?: unknown } } }
  if (!res.ok || body.error) throw new Error(body.error?.message || 'Simulation request failed.')
  if (body.result?.value?.err) throw new Error(`Simulation failed: ${JSON.stringify(body.result.value.err)}`)
}

/** Raw base units to a readable token amount, using the mint decimals. Display only. */
function tokenAmount(raw: string, decimals: number): string {
  if (!/^\d+$/.test(raw) || decimals <= 0) return raw
  const padded = raw.padStart(decimals + 1, '0')
  const whole = padded.slice(0, -decimals)
  const frac = padded.slice(-decimals).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole
}

function addAccount(list: HTMLUListElement, box: TokenBox, role: 'burn' | 'refund', checked: boolean) {
  const li = document.createElement('li')
  const label = document.createElement('label')
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.dataset.address = box.address
  input.checked = checked
  const text = document.createElement('span')
  text.className = 'account'
  const title = document.createElement('b')
  title.className = 'mono'
  title.textContent = box.mint
  const addr = document.createElement('span')
  addr.className = 'mono muted'
  addr.textContent = `account ${box.address}`
  text.append(title, addr)
  const amounts = document.createElement('span')
  amounts.className = 'amounts'
  const sol = lamportsToSol(role === 'refund' ? box.excessLamports : box.lamports)
  const solEl = document.createElement('b')
  solEl.textContent = `${fmt(sol)} SOL`
  const tokens = document.createElement('small')
  tokens.textContent = role === 'refund' ? 'extra rent' : `${tokenAmount(box.amount, box.decimals)} tokens`
  amounts.append(solEl, tokens)
  label.append(input, text, amounts)
  li.append(label)
  list.append(li)
}

function addPlain(list: HTMLUListElement, text: string) {
  const li = document.createElement('li')
  li.textContent = text
  list.append(li)
}

function addNote(list: HTMLUListElement, box: TokenBox) {
  const li = document.createElement('li')
  li.className = 'note-row'
  const why = document.createElement('span')
  why.className = 'badge'
  why.textContent = box.frozen ? 'frozen' : box.kind
  const text = document.createElement('span')
  text.className = 'account'
  const mint = document.createElement('span')
  mint.className = 'mono'
  mint.textContent = box.mint
  const addr = document.createElement('span')
  addr.className = 'mono muted'
  addr.textContent = `account ${box.address}`
  text.append(mint, addr)
  li.append(why, text)
  list.append(li)
}

const SHOW = 40

function fillList(list: HTMLUListElement, boxes: TokenBox[], role: 'burn' | 'refund' | 'note', checked: boolean) {
  const shown = boxes.slice(0, SHOW)
  for (const box of shown) {
    if (role === 'note') addNote(list, box)
    else addAccount(list, box, role, checked)
  }
  if (boxes.length > SHOW) {
    addPlain(list, `Showing ${SHOW} of ${boxes.length}. Rows past this stay untouched.`)
  }
}

function invalidatePlan() {
  plan = null
  planEl.hidden = true
  receiptEl.replaceChildren()
  sendEl.hidden = false
  sendEl.disabled = true
  setStatus('')
  sigsEl.replaceChildren()
}

function render(result: ScanResponse) {
  scan = result
  invalidatePlan()
  resultsEl.hidden = false
  const est = result.estimate
  statSol.textContent = fmt(est.sol, 4)
  statRent.textContent = fmt(est.emptySol)
  statEmpty.textContent = String(est.empty)
  scannedEl.textContent = result.address
  emptyLine.textContent = est.empty ? '' : 'No empty accounts to close.'
  closeEmptyEl.checked = est.empty > 0
  closeEmptyEl.disabled = est.empty === 0

  dustEl.replaceChildren()
  refundsEl.replaceChildren()
  untouchedEl.replaceChildren()

  const burnable = result.boxes.filter((box) => box.kind === 'dust' && !box.native && !box.frozen && !box.delegate)
  const refundable = result.boxes.filter((box) => box.kind !== 'empty' && canRefundExcess(box))
  const burnableSet = new Set(burnable.map((box) => box.address))
  const refundSet = new Set(refundable.map((box) => box.address))

  fillList(dustEl, burnable, 'burn', false)
  dustEmpty.hidden = burnable.length > 0
  fillList(refundsEl, refundable, 'refund', est.excess > 0)
  refundEmpty.hidden = refundable.length > 0

  const untouched = result.boxes.filter((box) => {
    if (box.kind === 'empty' && !box.frozen) return false
    return !burnableSet.has(box.address) && !refundSet.has(box.address)
  })
  fillList(untouchedEl, untouched, 'note', false)
  if (!untouched.length) addPlain(untouchedEl, 'Nothing else on this wallet.')
}

async function onScan() {
  clearErrors()
  invalidatePlan()
  batchEl.hidden = true
  resultsEl.hidden = true
  try {
    const address = walletAddress()
    render(await scanLocal(connection(), address))
  } catch (err) {
    setError(friendly(err))
  }
}

async function onReview() {
  if (!scan) return
  clearErrors()
  sendEl.disabled = true
  setStatus('')
  sigsEl.replaceChildren()
  try {
    const burns = checkedAddresses(dustEl)
    const refunds = checkedAddresses(refundsEl)
    plan = await planLocal(connection(), {
      address: scan.address,
      boxes: scan.boxes,
      closeEmpty: closeEmptyEl.checked,
      burnAccounts: burns,
      refundExcess: refunds.length > 0,
      refundAccounts: refunds,
      feePercent: FEE_PERCENT,
      treasury: TREASURY,
    })
    const reviewed = inspectPlan(plan.txs, plan.address)
    if (!reviewed.ok) throw new Error(reviewed.reason)
    if (!TREASURY) throw new Error('Set TREASURY_ADDRESS in .env, then restart this page.')
    if (FEE_PERCENT > 0 && (plan.feeLamports <= 0 || plan.txs.some((tx) => tx.description.feeTo !== TREASURY))) {
      throw new Error('This plan is missing the Grabster fee.')
    }
    fillMoney(receiptEl, plan, [])
    planEl.hidden = false
    sendEl.hidden = false
    sendEl.disabled = false
  } catch (err) {
    plan = null
    planEl.hidden = true
    setError(friendly(err), 'review')
  }
}

async function signAll(txs: Transaction[]): Promise<Transaction[]> {
  const connected = wallet ? walletAddressOf(wallet) : ''
  if (wallet && connected === plan?.address) {
    if (wallet.signAllTransactions) return wallet.signAllTransactions(txs)
    if (wallet.signTransaction) {
      const signed: Transaction[] = []
      for (const tx of txs) signed.push(await wallet.signTransaction(tx))
      return signed
    }
    throw new Error('This wallet cannot sign transactions.')
  }
  const secret = secretFromRaw(keyEl.value.trim())
  if (!secret) {
    throw new Error('Connect the wallet for this address, or paste its private key. The key stays in this tab.')
  }
  try {
    const owner = Keypair.fromSecretKey(secret)
    if (owner.publicKey.toBase58() !== plan?.address) {
      throw new Error('This key does not match the wallet that was scanned.')
    }
    return txs.map((tx) => {
      tx.partialSign(owner)
      return tx
    })
  } finally {
    secret.fill(0)
  }
}

async function onSend() {
  if (!plan || sending) return
  clearErrors()
  const connected = Boolean(wallet && walletAddressOf(wallet) === plan.address)
  if (!connected && !keyEl.value.trim()) {
    setError('Connect the wallet for this address, or paste its private key. The key stays in this tab.', 'send')
    return
  }
  sending = true
  sendEl.disabled = true
  const hadKey = keyEl.value.length > 0
  try {
    const reviewed = inspectPlan(plan.txs, plan.address)
    if (!reviewed.ok) throw new Error(reviewed.reason)
    const rpc = connection()
    const unsigned = plan.txs.map((row) => Transaction.from(b64ToBytes(row.tx)))
    setStatus(`Simulating these transactions on ${rpcHost() || 'your RPC'}…`)
    for (const tx of unsigned) await simulateUnsigned(rpc, tx)
    setStatus(wallet && walletAddressOf(wallet) === plan.address
      ? 'Waiting for the wallet to sign…'
      : 'Signing in this tab…')
    const signed = await signAll(unsigned)
    sigsEl.replaceChildren()
    setStatus('Sending…')
    const signatures: string[] = []
    for (const tx of signed) {
      signatures.push(await rpc.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 }))
    }
    fillMoney(receiptEl, plan, signatures)
    sigsEl.replaceChildren()
    sendEl.hidden = true
    if (hadKey) keyEl.value = ''
    setStatus('')
  } catch (err) {
    sendEl.disabled = false
    setStatus('')
    setError(friendly(err), 'send')
  } finally {
    sending = false
  }
}

const WALLET_ICON: Record<string, string> = {
  Phantom: '<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M2.20312 24.2683C2.20312 27.243 3.73559 27.9278 5.32937 27.9278C8.70078 27.9278 11.2345 24.8675 12.7465 22.4492C12.5626 22.9842 12.4605 23.5193 12.4605 24.0329C12.4605 25.4453 13.2369 26.4512 14.7694 26.4512C16.874 26.4512 19.1216 24.5251 20.2863 22.4492C20.2045 22.7488 20.1636 23.027 20.1636 23.2839C20.1636 24.2683 20.6949 24.8889 21.7779 24.8889C25.1902 24.8889 28.6229 18.5757 28.6229 13.0543C28.6229 8.75277 26.5387 4.96484 21.3079 4.96484C12.1131 4.96484 2.20312 16.6924 2.20312 24.2683ZM18.1408 12.5835C18.1408 11.5135 18.7129 10.7644 19.5507 10.7644C20.368 10.7644 20.9401 11.5135 20.9401 12.5835C20.9401 13.6535 20.368 14.424 19.5507 14.424C18.7129 14.424 18.1408 13.6535 18.1408 12.5835ZM22.5134 12.5835C22.5134 11.5135 23.0856 10.7644 23.9233 10.7644C24.7406 10.7644 25.3128 11.5135 25.3128 12.5835C25.3128 13.6535 24.7406 14.424 23.9233 14.424C23.0856 14.424 22.5134 13.6535 22.5134 12.5835Z"/></svg>',
  Solflare: '<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M16.1677 16.6108L17.9598 14.8796L21.3008 15.973C23.4877 16.702 24.5813 18.0384 24.5813 19.9216C24.5813 21.3492 24.0345 22.2908 22.9411 23.5058L22.607 23.8702L22.7285 23.0197C23.2144 19.9216 22.3033 18.5852 19.2962 17.6131L16.1677 16.6108ZM11.6724 6.01038L20.7846 9.04776L18.8102 10.9309L14.0719 9.3515C12.4318 8.80476 11.885 7.92392 11.6724 6.07113V6.01038ZM11.1256 21.4403L13.1911 19.4659L17.079 20.7417C19.1139 21.4099 19.8125 22.2908 19.6 24.5081L11.1256 21.4403ZM8.5135 12.6318C8.5135 12.0548 8.81723 11.5081 9.33359 11.0524C9.88032 11.8422 10.8219 12.5407 12.3102 13.0268L15.5299 14.0898L13.7378 15.8212L10.5789 14.7884C9.12097 14.3025 8.5135 13.5734 8.5135 12.6318ZM18.0509 28.5781C24.7331 24.1436 28.3172 21.1365 28.3172 17.4309C28.3172 14.9707 26.8592 13.6038 23.6397 12.5407L21.2097 11.7206L27.8617 5.34215L26.5251 3.91458L24.5509 5.64588L15.2262 2.57812C12.3406 3.51972 8.69575 6.28373 8.69575 9.04774C8.69575 9.35149 8.72612 9.65523 8.81724 9.98937C6.41771 11.3561 5.44575 12.6318 5.44575 14.2112C5.44575 15.6996 6.23546 17.1879 8.75649 18.0081L10.7612 18.6763L3.83594 25.3281L5.17238 26.7557L7.32893 24.7814L18.0509 28.5781Z"/></svg>',
}

function renderWalletActions() {
  actionsEl.querySelectorAll('.wallet-btn').forEach((el) => el.remove())
  if (wallet) {
    connectEl.hidden = false
    connectEl.textContent = 'Disconnect'
    return
  }
  const wallets = browserWallets()
  if (!wallets.length) {
    connectEl.hidden = false
    connectEl.textContent = 'Connect wallet'
    return
  }
  connectEl.hidden = true
  for (const item of wallets) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'btn btn-ghost wallet-btn'
    const icon = WALLET_ICON[item.label]
    if (icon) button.insertAdjacentHTML('beforeend', icon)
    const label = document.createElement('span')
    label.textContent = item.label
    button.append(label)
    button.addEventListener('click', () => { void connectProvider(item.provider) })
    actionsEl.append(button)
  }
}

async function connectProvider(provider: InjectedProvider) {
  clearErrors()
  try {
    const connected = await provider.connect()
    wallet = provider
    const fromResult = connected && typeof connected === 'object' ? keyText(connected.publicKey) : ''
    const address = fromResult || await waitForWalletAddress(provider)
    if (!address) throw new Error('The wallet connected, but did not share an address.')
    addressEl.value = address
    walletNote.textContent = `${walletLabel(provider)} is connected. The key stays in the extension. Scan this address, then sign from the wallet.`
    renderWalletActions()
    if (scan && scan.address !== address) {
      resultsEl.hidden = true
      invalidatePlan()
    }
  } catch (err) {
    setError(friendly(err))
  }
}

async function onConnect() {
  clearErrors()
  if (!wallet) {
    setError('No wallet extension can see this page. Paste a private key, or open this file from http://localhost with Phantom or Solflare installed. A file opened from the disk (file://) usually cannot see the extension.')
    return
  }
  try { await wallet.disconnect?.() } catch { /* the extension may already be closed */ }
  wallet = null
  walletNote.textContent = ''
  renderWalletActions()
}

function parseKeyList(raw: string): { addr: string; secret: Uint8Array }[] {
  const out: { addr: string; secret: Uint8Array }[] = []
  const seen = new Set<string>()
  raw.split(/\r?\n/).forEach((line, index) => {
    const text = line.trim()
    if (!text) return
    const classified = classifyInput(text)
    if (classified.kind !== 'key') throw new Error(`Line ${index + 1} is not a private key.`)
    if (seen.has(classified.addr)) {
      classified.secret.fill(0)
      return
    }
    seen.add(classified.addr)
    out.push({ addr: classified.addr, secret: classified.secret })
  })
  if (!out.length) throw new Error('Paste at least one private key. One key per line.')
  return out
}

function reclaimable(result: ScanResponse): boolean {
  const empty = result.boxes.some((box) => box.kind === 'empty' && !box.frozen)
  const refund = result.boxes.some((box) => box.kind !== 'empty' && canRefundExcess(box))
  return empty || refund
}

function renderBatch() {
  batchRows.replaceChildren()
  let ready = 0
  for (const row of batch) {
    const card = document.createElement('article')
    card.className = 'batch-row'
    const head = document.createElement('div')
    head.className = 'batch-head'
    const title = document.createElement('h3')
    title.append(addressLink(row.address))
    const state = document.createElement('span')
    state.className = 'status'
    if (row.signatures.length) {
      state.dataset.s = 'ok'
      state.textContent = 'Sent'
    } else if (row.error) {
      state.dataset.s = 'bad'
      state.textContent = 'Not sent'
    } else if (row.plan || reclaimable(row.scan)) {
      state.dataset.s = 'none'
      state.textContent = 'Ready'
    } else {
      state.dataset.s = 'none'
      state.textContent = 'Nothing to reclaim'
    }
    head.append(title, state)
    card.append(head)
    if (row.plan) {
      const money = document.createElement('div')
      fillMoney(money, row.plan, row.signatures, true)
      card.append(money)
      if (!row.signatures.length && !row.error) ready += 1
    } else if (reclaimable(row.scan) && !row.error) {
      const note = document.createElement('p')
      note.className = 'hint'
      note.textContent = `${fmt(row.scan.estimate.emptySol)} SOL is locked in empty accounts.`
      card.append(note)
      ready += 1
    }
    if (row.error) {
      const err = document.createElement('p')
      err.className = 'alert'
      err.textContent = row.error
      card.append(err)
    }
    batchRows.append(card)
  }
  sendListEl.disabled = batchSending || ready === 0
  batchEl.hidden = false
}

async function onScanList() {
  clearErrors()
  resultsEl.hidden = true
  invalidatePlan()
  batch = []
  batchEl.hidden = true
  let addresses: string[] = []
  try {
    const parsed = parseKeyList(keysEl.value)
    addresses = parsed.map((row) => row.addr)
    for (const row of parsed) row.secret.fill(0)
    const rpc = connection()
    batchStatusEl.textContent = `Scanning ${addresses.length}…`
    for (const address of addresses) {
      const row: BatchRow = { address, scan: await scanLocal(rpc, address), plan: null, signatures: [], error: '' }
      if (reclaimable(row.scan)) {
        try {
          row.plan = await planList(rpc, row)
        } catch (err) {
          row.error = friendly(err)
        }
      }
      batch.push(row)
      renderBatch()
    }
    batchStatusEl.textContent = batch.some((row) => reclaimable(row.scan))
      ? 'Empty accounts will be closed. Tokens stay. Press Sign and send all.'
      : 'None of these wallets have rent to reclaim.'
  } catch (err) {
    batchStatusEl.textContent = ''
    setError(friendly(err))
  }
}

async function planList(rpc: Connection, row: BatchRow): Promise<PlanResponse> {
  const refunds = row.scan.boxes.filter((box) => box.kind !== 'empty' && canRefundExcess(box)).map((box) => box.address)
  const built = await planLocal(rpc, {
    address: row.address,
    boxes: row.scan.boxes,
    closeEmpty: row.scan.estimate.empty > 0,
    burnAccounts: [],
    refundExcess: refunds.length > 0,
    refundAccounts: refunds,
    feePercent: FEE_PERCENT,
    treasury: TREASURY,
  })
  const reviewed = inspectPlan(built.txs, built.address)
  if (!reviewed.ok) throw new Error(reviewed.reason)
  if (!TREASURY) throw new Error('Set TREASURY_ADDRESS in .env, then restart this page.')
  if (FEE_PERCENT > 0 && (built.feeLamports <= 0 || built.txs.some((tx) => tx.description.feeTo !== TREASURY))) {
    throw new Error('This plan is missing the Grabster fee.')
  }
  return built
}

async function signWith(secret: Uint8Array, address: string, txs: Transaction[]): Promise<Transaction[]> {
  const owner = Keypair.fromSecretKey(secret)
  if (owner.publicKey.toBase58() !== address) throw new Error('This key does not match the wallet that was scanned.')
  return txs.map((tx) => {
    tx.partialSign(owner)
    return tx
  })
}

async function onSendList() {
  if (batchSending) return
  clearErrors()
  batchSending = true
  sendListEl.disabled = true
  const secrets = new Map<string, Uint8Array>()
  try {
    const parsed = parseKeyList(keysEl.value)
    for (const row of parsed) secrets.set(row.addr, row.secret)
    const rpc = connection()
    let index = 0
    for (const row of batch) {
      index += 1
      if (row.signatures.length || !reclaimable(row.scan)) continue
      const secret = secrets.get(row.address)
      if (!secret) {
        row.error = 'That key is no longer in the list.'
        renderBatch()
        continue
      }
      try {
        batchStatusEl.textContent = `Wallet ${index} of ${batch.length}…`
        const built = await planList(rpc, row)
        row.plan = built
        renderBatch()
        const unsigned = built.txs.map((item) => Transaction.from(b64ToBytes(item.tx)))
        for (const tx of unsigned) await simulateUnsigned(rpc, tx)
        const signed = await signWith(secret, row.address, unsigned)
        const signatures: string[] = []
        for (const tx of signed) {
          signatures.push(await rpc.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 }))
        }
        row.signatures = signatures
        row.error = ''
      } catch (err) {
        row.error = friendly(err)
      } finally {
        secret.fill(0)
        secrets.delete(row.address)
      }
      renderBatch()
    }
    const failed = batch.some((row) => row.error)
    if (!failed) keysEl.value = ''
    batchStatusEl.textContent = failed
      ? 'Some wallets did not send. The error is on that wallet. A signature means that wallet did send.'
      : 'Done. Each amount stayed on the wallet under it. Open a signature to see the transaction.'
  } catch (err) {
    batchErrorEl.textContent = friendly(err)
  } finally {
    for (const secret of secrets.values()) secret.fill(0)
    batchSending = false
    renderBatch()
  }
}

function setMode(list: boolean) {
  clearErrors()
  oneFields.hidden = list
  listFields.hidden = !list
  document.querySelector('#mode-one')!.classList.toggle('on', !list)
  document.querySelector('#mode-list')!.classList.toggle('on', list)
  document.querySelector('#mode-one')!.setAttribute('aria-selected', String(!list))
  document.querySelector('#mode-list')!.setAttribute('aria-selected', String(list))
  document.querySelector('#mode-one')!.setAttribute('tabindex', list ? '-1' : '0')
  document.querySelector('#mode-list')!.setAttribute('tabindex', list ? '0' : '-1')
  if (list) {
    resultsEl.hidden = true
    invalidatePlan()
  } else {
    batchEl.hidden = true
  }
}

document.querySelector('#mode-one')!.addEventListener('click', () => setMode(false))
document.querySelector('#mode-list')!.addEventListener('click', () => setMode(true))
document.querySelector('.mode')!.addEventListener('keydown', (event) => {
  const key = (event as KeyboardEvent).key
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return
  const list = !listFields.hidden
  setMode(!list)
  document.querySelector<HTMLButtonElement>(list ? '#mode-one' : '#mode-list')!.focus()
})
document.querySelector('#scan-list')!.addEventListener('click', () => void onScanList())
document.querySelector('#clear-keys')!.addEventListener('click', () => { keysEl.value = '' })
sendListEl.addEventListener('click', () => void onSendList())

document.querySelector('#scan')!.addEventListener('click', () => void onScan())
document.querySelector('#review')!.addEventListener('click', () => void onReview())
sendEl.addEventListener('click', () => void onSend())
connectEl.addEventListener('click', () => void onConnect())
addressEl.addEventListener('change', pullKeyOutOfAddress)
closeEmptyEl.addEventListener('change', invalidatePlan)
dustEl.addEventListener('change', invalidatePlan)
refundsEl.addEventListener('change', invalidatePlan)

document.querySelector('#toggle-key')!.addEventListener('click', () => {
  const showing = keyEl.type === 'text'
  keyEl.type = showing ? 'password' : 'text'
  document.querySelector('#toggle-key')!.textContent = showing ? 'Show' : 'Hide'
})

document.querySelector('#clear-key')!.addEventListener('click', () => {
  keyEl.value = ''
})

window.addEventListener('pagehide', () => {
  keyEl.value = ''
  keysEl.value = ''
})

document.querySelectorAll('.fee-pct').forEach((el) => {
  el.textContent = `${FEE_PERCENT}%`
})
document.querySelectorAll('.treasury').forEach((el) => {
  el.textContent = TREASURY ? short(TREASURY) : 'not set'
  if (TREASURY) el.setAttribute('title', TREASURY)
})
rpcEl.addEventListener('input', showRpcHost)
showRpcHost()
if (!TREASURY) setError('Set TREASURY_ADDRESS in .env, then restart this page.')
renderWalletActions()
