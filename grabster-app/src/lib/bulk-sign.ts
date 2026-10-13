import { fetchBalance } from './api'
import { watchSignatures } from './tx-status'
import { BULK_PARALLEL, bulkHasWork, runBulkWallet, runPool, skippedRow, waitBulkAdvance, waitBulkConnect, type BulkReportRow } from './bulk-run'
import { networkFeeSol, short, withBucks } from './mock'
import { secretFor } from './secrets'
import { connectWallet, connectWalletConnect, disconnectWallet, wallet, type WalletName } from './wallet'

let running = false

export function bulkSignRunning() {
  return running
}

export async function startBulkSign(opts: { resume?: boolean } = {}) {
  if (running) return
  running = true
  const { useStateStore } = await import('../stores/state')
  const { useUiStore } = await import('../stores/ui')
  const { useWalletStore } = await import('../stores/wallet')
  const flow = useStateStore()
  const ui = useUiStore()
  const wallets = useWalletStore()

  const pushReport = (report: BulkReportRow[], line: BulkReportRow) => {
    report.push(line)
    flow.bulkReport = [...report]
    if (line.partialPlan) flow.partialPlan = true
    watchSignatures(line.signatures)
  }

  const acceptNow = () => flow.bulkAccept

  const assertGas = async (address: string, boxes: number) => {
    if (flow.cfg.treasuryPaysGas) return
    const need = networkFeeSol(boxes, flow.dest, flow.cfg, flow.feeSplit)
    const { sol } = await fetchBalance(address)
    if (sol + 1e-9 < need) {
      throw new Error(`This wallet needs ~${withBucks(need, flow.solUsd, 4)} for network fees. It only has ${withBucks(sol, flow.solUsd, 4)}.`)
    }
  }

  const ensureBulkWallet = async (addr: string, prefer: WalletName | '') => {
    if (wallet.publicKey === addr) return
    flow.bulkPhase = 'need-connect'
    flow.bulkExpect = addr
    const other = wallet.publicKey && acceptNow().includes(wallet.publicKey) && wallet.publicKey !== addr
    flow.bulkMismatch = wallet.publicKey && !other
      ? `You're on ${short(wallet.publicKey)}. Open ${wallet.name || 'your wallet'}, switch to ${short(addr)}, then tap Connect wallet.`
      : ''
    if (prefer === 'Phantom' || prefer === 'Solflare') {
      try {
        await connectWallet(prefer)
        wallets.remember(wallet.publicKey)
        if (acceptNow().includes(wallet.publicKey)) return
        flow.bulkMismatch = `You're on ${short(wallet.publicKey)}. Open ${prefer}, switch to ${short(addr)}, then tap Connect wallet.`
      } catch {
        /* wait for the button */
      }
    } else if (prefer === 'WalletConnect') {
      try {
        await connectWalletConnect()
        wallets.remember(wallet.publicKey)
        if (acceptNow().includes(wallet.publicKey)) return
        flow.bulkMismatch = `You're on ${short(wallet.publicKey)}. Switch to ${short(addr)} in that wallet, then connect again.`
      } catch {
        /* wait for the button */
      }
    }
    if (prefer) wallets.open('bulk', addr)
    await waitBulkConnect()
  }

  try {
    const work = flow.bulkRows.filter((r) => bulkHasWork(r, flow.bulkExcess))
    const done = new Set(
      flow.bulkReport
        .filter((r) => r.status === 'closed' || r.status === 'skipped' || r.status === 'clean')
        .map((r) => r.addr),
    )
    const leftover = opts.resume ? work.filter((r) => !done.has(r.addr)) : work
    const clean: BulkReportRow[] = opts.resume
      ? []
      : flow.bulkRows.filter((r) => !bulkHasWork(r, flow.bulkExcess)).map((r) => ({
        addr: r.addr,
        status: 'clean' as const,
        boxes: 0,
        sol: 0,
        signatures: [],
        note: 'already clean',
      }))
    const secrets = leftover.filter((r) => Boolean(secretFor(r.addr)))
    const needWallet = leftover.filter((r) => !secretFor(r.addr))
    if (!leftover.length) {
      if (flow.bulkReport.some((r) => r.status === 'closed')) {
        flow.bulkPhase = 'idle'
        flow.finishOk()
        return
      }
      flow.screen = 'hero'
      return
    }

    if (!opts.resume) {
      ui.closeClaim()
      flow.goProgress(0)
    }
    const report: BulkReportRow[] = opts.resume ? [...flow.bulkReport] : [...clean]
    flow.bulkReport = [...report]
    flow.bulkQueueTotal = needWallet.length
    flow.bulkAccept = needWallet.map((r) => r.addr)
    if (needWallet.length) {
      flow.bulkQueueIndex = 0
      flow.bulkExpect = needWallet[0].addr
      if (!secrets.length) flow.bulkPhase = 'need-connect'
    }

    const run = (row: typeof leftover[0]) => runBulkWallet({
      address: row.addr,
      dest: flow.dest,
      other: flow.other,
      row,
      withExcess: flow.bulkExcess,
      append: (rows) => flow.appendProgress(rows),
      mark: (start, signatures, planned) => flow.markTxs(start, signatures, planned),
    }).then((line) => { pushReport(report, line) })

    await runPool(secrets, BULK_PARALLEL, run)

    flow.bulkQueueTotal = needWallet.length
    let prefer: WalletName | '' = wallet.name
    for (let i = 0; i < needWallet.length; i++) {
      flow.bulkAccept = needWallet.slice(i).map((r) => r.addr)
      let row = needWallet[i]
      flow.bulkQueueIndex = i
      flow.bulkExpect = row.addr
      flow.bulkMismatch = ''
      try {
        await ensureBulkWallet(row.addr, i === 0 ? '' : prefer)
      } catch (e) {
        if (e instanceof Error && e.message === 'stopped') throw e
        pushReport(report, skippedRow(row.addr, row.empty, e instanceof Error && e.message === 'skip' ? 'skipped' : 'not connected'))
        continue
      }
      const got = wallet.publicKey
      const swap = needWallet.findIndex((r, k) => k > i && r.addr === got)
      if (swap > i) {
        ;[needWallet[i], needWallet[swap]] = [needWallet[swap], needWallet[i]]
        row = needWallet[i]
        flow.bulkExpect = row.addr
        ui.showToast('That wallet is also in this list. Closing it first.')
      }
      if (got !== row.addr && !secretFor(row.addr)) {
        pushReport(report, skippedRow(row.addr, row.empty, 'connected a different wallet'))
        continue
      }
      flow.bulkPhase = 'signing'
      try {
        await assertGas(row.addr, row.empty || 1)
        pushReport(report, await runBulkWallet({
          address: row.addr,
          dest: flow.dest,
          other: flow.other,
          row,
          withExcess: flow.bulkExcess,
          append: (rows) => flow.appendProgress(rows),
          mark: (start, signatures, planned) => flow.markTxs(start, signatures, planned),
        }))
      } catch (e) {
        pushReport(report, {
          addr: row.addr,
          status: 'failed',
          boxes: 0,
          sol: 0,
          signatures: [],
          note: e instanceof Error ? e.message : 'Failed',
        })
      }
      prefer = wallet.name
      if (i < needWallet.length - 1) {
        flow.bulkQueueIndex = i + 1
        flow.bulkExpect = needWallet[i + 1].addr
        flow.bulkAccept = needWallet.slice(i + 1).map((r) => r.addr)
        flow.bulkPhase = 'need-switch'
        flow.bulkMismatch = ''
        try {
          await waitBulkAdvance()
        } catch (e) {
          if (e instanceof Error && e.message === 'stopped') throw e
          break
        }
        await disconnectWallet()
        wallets.forget()
      }
    }

    flow.bulkPhase = 'idle'
    flow.bulkAccept = []
    flow.bulkReport = report
    if (!report.some((r) => r.status === 'closed')) {
      flow.screen = 'hero'
      ui.showToast('Nothing was closed.')
      return
    }
    flow.finishOk()
  } finally {
    running = false
  }
}
