import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  classifyInput,
  totals,
  bulkTotals,
  sweepCreditSol,
  type Destination,
  type DustMode,
  type InputKind,
  type PublicConfig,
  type ScanEstimate,
  type ScanResponse,
  type TokenBox,
  canRefundExcess,
  DUST_SHARE,
  TX_PER_BATCH,
  lamportsToSol,
  refundWorthIt,
} from '@grabster/solana-core'
import { classifyLoose, expandMnemonic } from '../lib/bulk-input'
import { abortBulkWaits, type BulkPhase, type BulkReportRow } from '../lib/bulk-run'
import { clearFlowSnap, readFlowSnap, sanitizeSnap, writeFlowSnap } from '../lib/flow-persist'
import { fetchConfig, fetchScan, fetchScanBatch } from '../lib/api'
import { LIST_ROUTE, go, replace } from '../lib/nav'
import { forgetSecrets, rememberSecret } from '../lib/secrets'
import { watchSignatures } from '../lib/tx-status'
import { useAuthStore } from './auth'
import { useUiStore } from './ui'
import { useWalletStore } from './wallet'

export type Screen = 'hero' | 'scan' | 'result' | 'empty' | 'progress' | 'done'
/** Where a single-wallet reclaim stands, for button and progress copy. '' = not running. */
export type RunPhase = '' | 'preparing' | 'approve' | 'confirming'
/** One sent transaction. `lamports` = SOL it moves to the recipient (recovered − Grabster fee + credit). */
export interface Tx { ok: boolean; sig: string; boxes: number; wallet?: string; lamports?: number; dropped?: boolean }
export interface ListWallet { addr: string; kind: 'address' | 'key' | 'seed' }

const defaultCfg: PublicConfig = {
  feeDirect: 1,
  feeBalance: 0.5,
  gas: 0.0002,
  rentNow: 0.001856,
  txPerBatch: TX_PER_BATCH,
  refShare: 25,
  demoAddress: '',
  treasury: '',
  treasuryPaysGas: false,
  keepAboveUsd: 5,
  dustShare: DUST_SHARE,
  withdrawMinSol: 0.01,
  withdrawFeeSol: 0,
  withdrawDailySol: 5,
  solUsd: 0,
  features: { balance: true, sweep: false, nftBurn: false, excessRent: false, referrals: true },
}

export const useStateStore = defineStore('state', () => {
  const screen = ref<Screen>('hero')
  const mode = ref<'single' | 'bulk'>('single')
  const input = ref('')
  const kind = ref<InputKind>('')
  const addr = ref('')
  const err = ref('')
  const notice = ref('')
  const est = ref<ScanEstimate | null>(null)
  const boxes = ref<TokenBox[]>([])
  const keepDust = ref<string[]>([])
  const keepNft = ref<string[]>([])
  const skipRefund = ref<string[]>([])
  const dest = ref<Destination>('same')
  const other = ref('')
  const otherInvalid = ref(false)
  const dustMode = ref<DustMode>('keep')
  const nftOn = ref(false)
  const excessOn = ref(false)
  const scanStep = ref(0)
  const txs = ref<Tx[]>([])
  const total = ref(0)
  const bulkText = ref('')
  const bulkRows = ref<ScanEstimate[]>([])
  const bulkReport = ref<BulkReportRow[]>([])
  const bulkPhase = ref<BulkPhase>('idle')
  const bulkExpect = ref('')
  const bulkQueueIndex = ref(0)
  const bulkQueueTotal = ref(0)
  const bulkMismatch = ref('')
  const bulkAccept = ref<string[]>([])
  /** The validated wallet list, in the order the user gave it. */
  const bulkList = ref<ListWallet[]>([])
  /** Wallets whose check failed, with the reason. They are not in bulkRows and never get planned. */
  const bulkErrors = ref<Record<string, string>>({})
  /** Extra-rent refunds are a separate operation: off unless the user turns it on for the list. */
  const bulkExcess = ref(false)
  /** Single wallet: burn / give / NFT / extra-rent controls are shown only after the user asks for them. */
  const advanced = ref(false)
  /**
   * Some transactions landed from a plan that did not finish (then the run stopped or rebuilt).
   * The server books a Grabster-balance credit only for completed plans, so those aren't credited.
   */
  const partialPlan = ref(false)
  const cfg = ref<PublicConfig>({ ...defaultCfg })
  const busy = ref(false)
  const runPhase = ref<RunPhase>('')

  /*
   * Four different addresses, kept apart on purpose (single wallet):
   * - addr: the checked wallet, owner of the accounts being closed;
   * - requiredSigner: who must sign the plan — the owner (close authority) of those accounts;
   * - recipientAddr: where the SOL goes (this wallet, another address, or a Grabster balance);
   * - the Grabster sign-in account (auth store) — it owns the Grabster balance a credit lands in.
   * The connected wallet (lib/wallet) can be any of these, or none.
   */
  const requiredSigner = computed(() => addr.value)
  const recipientAddr = computed(() => {
    if (dest.value === 'other') return other.value
    if (dest.value === 'balance') return useAuthStore().address
    return addr.value
  })

  function defaultDest(): Destination {
    return 'same'
  }

  const dustRows = computed(() => boxes.value.filter((b) => b.kind === 'dust'))
  const sweepRows = computed(() => dustRows.value.filter((b) => b.sweepable))
  const burnAccounts = computed(() =>
    dustMode.value === 'burn'
      ? dustRows.value.filter((b) => !keepDust.value.includes(b.address)).map((b) => b.address)
      : [],
  )
  const sweepAccounts = computed(() =>
    dustMode.value === 'give'
      ? sweepRows.value.filter((b) => !keepDust.value.includes(b.address)).map((b) => b.address)
      : [],
  )
  const burnDustSol = computed(() => {
    if (dustMode.value !== 'burn') return 0
    const picked = dustRows.value.filter((b) => !keepDust.value.includes(b.address))
    return lamportsToSol(picked.reduce((s, b) => s + b.lamports, 0))
  })
  const sweepDustSol = computed(() => {
    if (dustMode.value !== 'give') return 0
    const picked = sweepRows.value.filter((b) => !keepDust.value.includes(b.address))
    return lamportsToSol(picked.reduce((s, b) => s + b.lamports, 0))
  })
  const sweepBonusSol = computed(() => {
    if (dustMode.value !== 'give') return 0
    const picked = sweepRows.value.filter((b) => !keepDust.value.includes(b.address))
    return picked.reduce(
      (s, b) => s + sweepCreditSol(
        b.netValueUsd || b.valueUsd,
        est.value?.solUsd || 0,
        cfg.value.dustShare || DUST_SHARE,
      ),
      0,
    )
  })
  const canGive = computed(() =>
    Boolean(cfg.value.features.sweep && cfg.value.treasury && sweepRows.value.length),
  )
  const nftRows = computed(() => boxes.value.filter((b) => b.kind === 'nft' && b.nftBurnable))
  const nftAccounts = computed(() =>
    nftOn.value && cfg.value.features.nftBurn
      ? nftRows.value.filter((b) => !keepNft.value.includes(b.address)).map((b) => b.address)
      : [],
  )
  const nftBurnSol = computed(() => {
    if (!nftOn.value) return 0
    const picked = nftRows.value.filter((b) => !keepNft.value.includes(b.address))
    return lamportsToSol(picked.reduce((s, b) => s + b.lamports + b.extraLamports, 0))
  })
  const closing = computed(() => new Set([
    ...boxes.value.filter((b) => b.kind === 'empty').map((b) => b.address),
    ...burnAccounts.value,
    ...sweepAccounts.value,
    ...nftAccounts.value,
  ]))
  const refundRows = computed(() =>
    cfg.value.features.excessRent
      ? boxes.value.filter((b) => canRefundExcess(b) && !closing.value.has(b.address))
      : [],
  )
  const canRefund = computed(() => {
    const lamports = refundRows.value.reduce((s, b) => s + b.excessLamports, 0)
    return refundWorthIt(lamports, refundRows.value.length, cfg.value.gas)
  })
  const refundPicked = computed(() =>
    excessOn.value && canRefund.value
      ? refundRows.value.filter((b) => !skipRefund.value.includes(b.address))
      : [],
  )
  const refundAccounts = computed(() => {
    const picked = refundPicked.value
    const lamports = picked.reduce((s, b) => s + b.excessLamports, 0)
    return refundWorthIt(lamports, picked.length, cfg.value.gas) ? picked.map((b) => b.address) : []
  })
  const refundSol = computed(() => {
    const picked = refundRows.value.filter((b) => refundAccounts.value.includes(b.address))
    return lamportsToSol(picked.reduce((s, b) => s + b.excessLamports, 0))
  })
  const feeSplit = computed(() => ({
    emptyBoxes: est.value?.empty ?? 0,
    dustBoxes: dustMode.value === 'give' ? sweepAccounts.value.length : burnAccounts.value.length,
    nftBoxes: nftAccounts.value.length,
    refundBoxes: refundAccounts.value.length,
    sweep: dustMode.value === 'give',
  }))

  const tot = computed(() =>
    mode.value === 'bulk'
      ? bulkTotals(bulkRows.value, dest.value, cfg.value, bulkExcess.value)
      : est.value
        ? totals(
          est.value,
          dest.value,
          dustMode.value,
          nftOn.value && cfg.value.features.nftBurn,
          cfg.value,
          {
            ...(dustMode.value === 'give'
              ? { dustBoxes: sweepAccounts.value.length, dustSol: sweepDustSol.value, bonusSol: sweepBonusSol.value }
              : dustRows.value.length
                ? { dustBoxes: burnAccounts.value.length, dustSol: burnDustSol.value }
                : {}),
            nftBoxes: nftAccounts.value.length,
            nftSol: nftBurnSol.value,
            excessSol: refundSol.value,
            excessBoxes: refundAccounts.value.length,
          },
        )
        : { fee: 0, gross: 0, feeSol: 0, bonus: 0, net: 0, boxes: 0 },
  )

  const solUsd = computed(() => {
    if ((est.value?.solUsd || 0) > 0) return est.value!.solUsd
    const bulk = bulkRows.value.find((r) => r.solUsd > 0)?.solUsd || 0
    if (bulk > 0) return bulk
    return cfg.value.solUsd || 0
  })

  const shouldWarnLeave = computed(() =>
    screen.value === 'progress'
    || screen.value === 'scan'
    || bulkPhase.value === 'need-connect'
    || bulkPhase.value === 'signing'
    || bulkPhase.value === 'need-switch',
  )

  function toggleDust(address: string) {
    const i = keepDust.value.indexOf(address)
    keepDust.value = i < 0 ? [...keepDust.value, address] : keepDust.value.filter((a) => a !== address)
  }

  function toggleNft(address: string) {
    const i = keepNft.value.indexOf(address)
    keepNft.value = i < 0 ? [...keepNft.value, address] : keepNft.value.filter((a) => a !== address)
  }

  function toggleRefund(address: string) {
    const i = skipRefund.value.indexOf(address)
    skipRefund.value = i < 0 ? [...skipRefund.value, address] : skipRefund.value.filter((a) => a !== address)
  }

  let skipPersist = false

  function hydrate() {
    const raw = readFlowSnap()
    if (!raw) return
    const snap = sanitizeSnap(raw)
    skipPersist = true
    mode.value = snap.mode
    screen.value = snap.screen
    dest.value = snap.dest
    other.value = snap.other
    addr.value = snap.addr
    kind.value = snap.kind
    input.value = snap.input
    notice.value = snap.notice
    est.value = snap.est
    boxes.value = snap.boxes || []
    keepDust.value = snap.keepDust || []
    keepNft.value = snap.keepNft || []
    skipRefund.value = snap.skipRefund || []
    dustMode.value = snap.dustMode || 'keep'
    nftOn.value = snap.nftOn
    excessOn.value = snap.excessOn
    txs.value = snap.txs || []
    total.value = snap.total || 0
    bulkText.value = snap.bulkText || ''
    bulkRows.value = snap.bulkRows || []
    bulkReport.value = snap.bulkReport || []
    bulkPhase.value = snap.bulkPhase || 'idle'
    bulkExpect.value = snap.bulkExpect || ''
    bulkQueueIndex.value = snap.bulkQueueIndex || 0
    bulkQueueTotal.value = snap.bulkQueueTotal || 0
    bulkAccept.value = snap.bulkAccept || []
    bulkList.value = snap.bulkList || snap.bulkRows.map((r) => ({ addr: r.addr, kind: 'address' as const }))
    bulkErrors.value = snap.bulkErrors || {}
    bulkExcess.value = Boolean(snap.bulkExcess)
    advanced.value = Boolean(snap.advanced)
    partialPlan.value = Boolean(snap.partialPlan)
    skipPersist = false
  }

  function persist() {
    if (skipPersist) return
    if (screen.value === 'hero' && !bulkRows.value.length && !bulkList.value.length && !est.value) {
      clearFlowSnap()
      return
    }
    writeFlowSnap({
      v: 1,
      mode: mode.value,
      screen: screen.value,
      dest: dest.value,
      other: other.value,
      addr: addr.value,
      kind: kind.value,
      input: addr.value,
      notice: notice.value,
      est: est.value,
      boxes: boxes.value,
      keepDust: keepDust.value,
      keepNft: keepNft.value,
      skipRefund: skipRefund.value,
      dustMode: dustMode.value,
      nftOn: nftOn.value,
      excessOn: excessOn.value,
      txs: txs.value,
      total: total.value,
      bulkText: bulkRows.value.map((r) => r.addr).join('\n') || bulkText.value,
      bulkRows: bulkRows.value,
      bulkReport: bulkReport.value,
      bulkPhase: bulkPhase.value,
      bulkExpect: bulkExpect.value,
      bulkQueueIndex: bulkQueueIndex.value,
      bulkQueueTotal: bulkQueueTotal.value,
      bulkAccept: bulkAccept.value,
      bulkList: bulkList.value,
      bulkErrors: bulkErrors.value,
      bulkExcess: bulkExcess.value,
      advanced: advanced.value,
      partialPlan: partialPlan.value,
    })
  }

  function reset() {
    skipPersist = true
    clearFlowSnap()
    forgetSecrets()
    screen.value = 'hero'
    mode.value = 'single'
    input.value = ''
    kind.value = ''
    addr.value = ''
    err.value = ''
    notice.value = ''
    est.value = null
    boxes.value = []
    keepDust.value = []
    keepNft.value = []
    skipRefund.value = []
    dest.value = defaultDest()
    other.value = ''
    otherInvalid.value = false
    dustMode.value = 'keep'
    nftOn.value = false
    excessOn.value = false
    txs.value = []
    total.value = 0
    bulkText.value = ''
    bulkRows.value = []
    bulkReport.value = []
    bulkList.value = []
    bulkErrors.value = {}
    bulkExcess.value = false
    advanced.value = false
    partialPlan.value = false
    resetBulkQueue()
    useUiStore().closeClaim()
    useWalletStore().close()
    skipPersist = false
  }

  function cancelFlow() {
    const wasBulk = mode.value === 'bulk'
    reset()
    if (wasBulk) {
      mode.value = 'bulk'
      dest.value = defaultDest()
      void go(LIST_ROUTE)
    } else {
      void go({ name: 'home' })
    }
  }

  /**
   * Only an unfinished list signing pulls the user back from the home page — it needs them to continue.
   * Finished or read-only results stay in Cleanup without hiding the home page.
   */
  function restoreRoute() {
    if (mode.value === 'bulk' && screen.value === 'progress') {
      if (typeof location !== 'undefined' && location.pathname === '/') void go(LIST_ROUTE)
    }
  }

  function resetBulkQueue() {
    abortBulkWaits()
    bulkPhase.value = 'idle'
    bulkExpect.value = ''
    bulkQueueIndex.value = 0
    bulkQueueTotal.value = 0
    bulkMismatch.value = ''
    bulkAccept.value = []
  }

  function goHome() {
    const run = () => {
      void Promise.resolve(go({ name: 'home' })).then(() => {
        reset()
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
      })
    }
    if (shouldWarnLeave.value) {
      useUiStore().askLeave(run)
      return
    }
    run()
  }

  async function loadConfig() {
    try {
      cfg.value = await fetchConfig()
    } catch {
      /* keep defaults so the landing still renders */
    }
  }

  /**
   * Single-wallet check. The address field only takes public addresses; a key or seed
   * phrase is accepted only from the separate key field (`allowSecret`), and then it
   * stays in this tab's memory.
   */
  function startScan(raw: string, opts: { allowSecret?: boolean; kind?: InputKind } = {}): boolean {
    if (raw.trim().toLowerCase() === 'demo') {
      if (!cfg.value.demoAddress) { err.value = 'No demo wallet is configured on the server.'; return false }
      err.value = ''
      kind.value = 'address'
      addr.value = cfg.value.demoAddress
      mode.value = 'single'
      notice.value = ''
      useUiStore().closeClaim()
      void runScan()
      return true
    }
    const c = classifyLoose(raw)
    if ((c.kind === 'seed' || c.kind === 'key') && !opts.allowSecret) {
      err.value = c.kind === 'seed'
        ? 'That’s a seed phrase, not an address. Nothing was sent. To sign with it in this browser, use “Sign with a private key” below.'
        : 'That’s a private key, not an address. Nothing was sent. To sign with it in this browser, use “Sign with a private key” below.'
      return false
    }
    if (c.kind === 'seed') {
      const first = expandMnemonic(c.mnemonic, { from: 0, to: 0 })[0]
      if (!first?.secret) { err.value = 'That seed phrase didn’t produce a wallet.'; return false }
      err.value = ''
      kind.value = 'seed'
      addr.value = first.addr
      mode.value = 'single'
      notice.value = 'Seed phrase: we use the first account. It stays in this tab and signs here.'
      rememberSecret(first.addr, first.secret)
      useUiStore().closeClaim()
      void runScan()
      return true
    }
    if (c.kind === 'bad' || c.kind === 'none') {
      err.value = opts.allowSecret
        ? 'That doesn’t look like a Solana private key or seed phrase.'
        : 'That doesn’t look like a Solana wallet address.'
      return false
    }
    err.value = ''
    kind.value = opts.kind || c.kind
    addr.value = c.addr
    mode.value = 'single'
    notice.value = c.kind === 'key' ? 'Private key: it stays in this tab and signs here. Grabster never receives it.' : ''
    if (c.kind === 'key') rememberSecret(c.addr, c.secret)
    useUiStore().closeClaim()
    void runScan()
    return true
  }

  let scanTimer: number | undefined
  let scanGen = 0

  /** Put a finished scan into the single-wallet flow (fresh defaults: empty accounts only, back to the same wallet). */
  function applyScanResult(res: ScanResponse) {
    est.value = { ...res.estimate, kind: kind.value }
    boxes.value = res.boxes || []
    keepDust.value = []
    keepNft.value = []
    skipRefund.value = []
    dest.value = defaultDest()
    dustMode.value = 'keep'
    // Burning NFTs and pulling extra rent are separate operations — off until chosen.
    nftOn.value = false
    excessOn.value = false
    advanced.value = false
    useWalletStore().signer = ''
    const e = est.value
    screen.value = !e.empty && !e.dust && !e.nft && !e.excess ? 'empty' : 'result'
  }

  /**
   * Hand a scan made elsewhere (the home page check) to the single-wallet flow, so the review
   * opens on that result without scanning the same address again.
   */
  function adoptScan(address: string, res: ScanResponse) {
    scanGen++ // any scan still in flight belongs to an older request
    useUiStore().closeClaim()
    err.value = ''
    notice.value = ''
    txs.value = []
    total.value = 0
    partialPlan.value = false
    mode.value = 'single'
    kind.value = 'address'
    addr.value = address
    input.value = address
    applyScanResult(res)
  }

  async function runScan() {
    const gen = ++scanGen
    screen.value = 'scan'
    scanStep.value = 0
    busy.value = true
    void go({ name: 'check', params: { address: addr.value } })
    window.clearInterval(scanTimer)
    scanTimer = window.setInterval(() => {
      if (scanStep.value < 4) scanStep.value++
    }, 520)
    try {
      const res = await fetchScan(addr.value)
      if (gen !== scanGen) return // superseded by a newer scan or an adopted result
      applyScanResult(res)
    } catch (e) {
      if (gen !== scanGen) return
      err.value = e instanceof Error ? e.message : 'Could not read that wallet. Check the RPC and try again.'
      screen.value = 'hero'
      void replace({ name: 'cleanup' })
    } finally {
      // A superseded scan leaves the newer one's spinner alone.
      if (gen === scanGen) {
        window.clearInterval(scanTimer)
        busy.value = false
      }
    }
  }

  /** Check a validated list. Secrets for key/seed rows must already be in memory (rememberSecret). */
  async function runBulk(list: ListWallet[]) {
    mode.value = 'bulk'
    err.value = ''
    bulkList.value = list
    bulkText.value = list.map((w) => w.addr).join('\n')
    bulkRows.value = []
    bulkErrors.value = {}
    bulkReport.value = []
    resetBulkQueue()
    screen.value = 'hero'
    await scanList(list.map((w) => w.addr))
  }

  /** Check again only the wallets that failed. Results already in hand stay. */
  async function retryFailed() {
    const failed = Object.keys(bulkErrors.value)
    if (!failed.length || busy.value) return
    const next = { ...bulkErrors.value }
    for (const a of failed) delete next[a]
    bulkErrors.value = next
    await scanList(failed)
  }

  async function scanList(addresses: string[]) {
    busy.value = true
    const kindOf = new Map(bulkList.value.map((w) => [w.addr, w.kind]))
    const size = Math.max(1, Math.min(cfg.value.limits?.scanBatch ?? 100, 100))
    const fail = (a: string, why: string) => { bulkErrors.value = { ...bulkErrors.value, [a]: why } }
    const ok = (row: ScanEstimate) => {
      bulkRows.value = [...bulkRows.value.filter((r) => r.addr !== row.addr), { ...row, kind: kindOf.get(row.addr) || 'address' }]
    }
    try {
      for (let i = 0; i < addresses.length; i += size) {
        const chunk = addresses.slice(i, i + size)
        try {
          const res = await fetchScanBatch(chunk)
          const seen = new Set<string>()
          for (const row of res.rows) {
            seen.add(row.address)
            if (row.error) fail(row.address, row.error)
            else ok(row.estimate)
          }
          for (const a of chunk) if (!seen.has(a)) fail(a, 'No answer for this wallet.')
        } catch {
          // The batch call failed as a whole: fall back to one request per wallet so one bad RPC answer can't hide the rest.
          for (const a of chunk) {
            try {
              ok((await fetchScan(a)).estimate)
            } catch (e) {
              fail(a, e instanceof Error ? e.message : 'Could not read that wallet.')
            }
          }
        }
      }
    } finally {
      busy.value = false
    }
  }

  function claimAllowed(): boolean {
    if (mode.value === 'bulk') {
      if (tot.value.boxes <= 0 && tot.value.net <= 0) return false
    } else if (!est.value || (tot.value.boxes <= 0 && refundAccounts.value.length <= 0)) {
      return false
    }
    if (dest.value === 'other' && !('addr' in classifyInput(other.value))) { otherInvalid.value = true; return false }
    if (dest.value === 'balance' && !cfg.value.features.balance) { err.value = 'Grabster balance is not enabled yet. Send SOL to the same wallet or another address.'; return false }
    return true
  }

  function openClaim(): boolean {
    if (!claimAllowed()) return false
    if (dest.value === 'balance' && !useAuthStore().address) {
      useWalletStore().open('claim-login')
      return false
    }
    useUiStore().openClaim()
    return true
  }

  function markProgress(next: Tx[]) {
    txs.value = next
    total.value = next.length
  }

  function appendProgress(rows: Tx[]): number {
    const start = txs.value.length
    txs.value = [...txs.value, ...rows]
    total.value = txs.value.length
    return start
  }

  function markTxs(start: number, signatures: string[], planned = signatures.length) {
    signatures.forEach((sig, i) => {
      const row = txs.value[start + i]
      if (row) { row.ok = true; row.sig = sig }
    })
    // Rows of this attempt after the landed ones were never sent (a rebuilt plan replaces them).
    for (let i = signatures.length; i < planned; i++) {
      const row = txs.value[start + i]
      if (row && !row.ok) row.dropped = true
    }
    watchSignatures(signatures)
  }

  function finishOk() {
    screen.value = 'done'
  }

  function goProgress(nextTotal = 0) {
    partialPlan.value = false
    screen.value = 'progress'
    txs.value = []
    total.value = nextTotal
  }

  hydrate()
  watch(
    [
      screen, mode, dest, other, addr, kind, notice, est, boxes,
      keepDust, keepNft, skipRefund, dustMode, nftOn, excessOn,
      txs, total, bulkRows, bulkReport, bulkPhase, bulkExpect,
      bulkQueueIndex, bulkQueueTotal, bulkAccept,
      bulkList, bulkErrors, bulkExcess, advanced, partialPlan,
    ],
    persist,
    { deep: true },
  )

  return {
    screen, mode, input, kind, addr, err, notice, est, boxes, keepDust, keepNft, skipRefund, dest, other, otherInvalid,
    dustMode, nftOn, excessOn, scanStep, txs, total, bulkText, bulkRows, bulkReport,
    bulkPhase, bulkExpect, bulkQueueIndex, bulkQueueTotal, bulkMismatch, bulkAccept,
    bulkList, bulkErrors, bulkExcess, advanced, partialPlan,
    cfg, busy, runPhase, requiredSigner, recipientAddr, tot, feeSplit, solUsd, shouldWarnLeave,
    dustRows, sweepRows, burnAccounts, sweepAccounts, burnDustSol, sweepDustSol, sweepBonusSol, canGive,
    nftRows, nftAccounts, nftBurnSol, refundRows, refundAccounts, refundSol, canRefund, toggleDust, toggleNft, toggleRefund,
    reset, resetBulkQueue, cancelFlow, restoreRoute, goHome, loadConfig, startScan, runScan, adoptScan, runBulk, retryFailed, claimAllowed, openClaim,
    markProgress, appendProgress, markTxs, finishOk, goProgress,
  }
})
