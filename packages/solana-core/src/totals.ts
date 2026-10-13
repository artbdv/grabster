import { NFT_PER_BATCH, REFUND_PER_BATCH, SWEEP_PER_BATCH, TX_PER_BATCH } from './programs'
import type { Destination, DustMode, ScanEstimate } from './types'

export interface Totals {
  fee: number
  gross: number
  feeSol: number
  bonus: number
  net: number
  boxes: number
}

/** Empty boxes always. Dust if the user chose burn or give. NFT only if nft burn is on. */
export function totals(
  est: ScanEstimate,
  dest: Destination,
  dustMode: DustMode,
  nftOn: boolean,
  cfg: { feeDirect: number; feeBalance: number; gas?: number; txPerBatch?: number; treasuryPaysGas?: boolean },
  pick?: { dustBoxes?: number; dustSol?: number; bonusSol?: number; nftBoxes?: number; nftSol?: number; excessSol?: number; excessBoxes?: number },
): Totals {
  const fee = dest === 'balance' ? cfg.feeBalance : cfg.feeDirect
  const nftSol = nftOn ? (pick?.nftSol ?? est.nftSol) : 0
  const nftBoxes = nftOn ? (pick?.nftBoxes ?? est.nft) : 0
  const dustOn = dustMode === 'burn' || dustMode === 'give'
  const dustBoxes = dustOn ? (pick?.dustBoxes ?? est.dust) : 0
  const dustSol = dustOn ? (pick?.dustSol ?? est.dustSol) : 0
  const excessSol = pick?.excessSol ?? 0
  const excessBoxes = pick?.excessBoxes ?? 0
  const boxes = est.empty + dustBoxes + nftBoxes
  const gross = est.emptySol + dustSol + nftSol + excessSol
  const feeSol = (gross * fee) / 100
  const bonus = dustMode === 'give' ? (pick?.bonusSol ?? 0) : 0
  const covered = Boolean(cfg.treasuryPaysGas && est.noSol)
  const gasWithhold =
    cfg.gas != null
      ? treasuryGasWithholdSol(
        boxes,
        { gas: cfg.gas, txPerBatch: cfg.txPerBatch ?? TX_PER_BATCH },
        covered,
        { emptyBoxes: est.empty, dustBoxes, nftBoxes, refundBoxes: excessBoxes, sweep: dustMode === 'give' },
      )
      : 0
  return {
    fee,
    gross,
    feeSol,
    bonus,
    net: Math.max(0, gross - feeSol - gasWithhold + bonus),
    boxes,
  }
}

function txCount(boxes: number, txPerBatch: number): number {
  return Math.max(1, Math.ceil(boxes / Math.max(1, txPerBatch)))
}

function planTxCount(
  boxes: number,
  txPerBatch: number,
  split?: { emptyBoxes: number; dustBoxes: number; nftBoxes?: number; refundBoxes?: number; sweep: boolean },
): number {
  const refund = (split?.refundBoxes ?? 0) > 0 ? txCount(split?.refundBoxes ?? 0, REFUND_PER_BATCH) : 0
  if (!split || boxes <= 0) {
    const base = boxes > 0 ? txCount(boxes, txPerBatch) : 0
    return base + refund
  }
  const close = split.emptyBoxes > 0 ? txCount(split.emptyBoxes, txPerBatch) : 0
  const dust = split.dustBoxes > 0
    ? txCount(split.dustBoxes, split.sweep ? SWEEP_PER_BATCH : txPerBatch)
    : 0
  const nft = (split.nftBoxes ?? 0) > 0 ? txCount(split.nftBoxes ?? 0, NFT_PER_BATCH) : 0
  return close + dust + nft + refund
}

/** SOL the fee-payer must already hold. Later txs can reuse rent if it stays in the same wallet. */
export function networkFeeSol(
  boxes: number,
  dest: Destination,
  cfg: { gas: number; txPerBatch: number },
  split?: { emptyBoxes: number; dustBoxes: number; nftBoxes?: number; refundBoxes?: number; sweep: boolean },
): number {
  const n = planTxCount(boxes, cfg.txPerBatch, split)
  if (n <= 0) return 0
  return cfg.gas * (dest === 'same' ? 1 : n)
}

/** 2× estimated network fee, taken from recovered SOL when treasury pays gas. */
export function treasuryGasWithholdSol(
  boxes: number,
  cfg: { gas: number; txPerBatch: number },
  covered: boolean,
  split?: { emptyBoxes: number; dustBoxes: number; nftBoxes?: number; refundBoxes?: number; sweep: boolean },
): number {
  const n = planTxCount(boxes, cfg.txPerBatch, split)
  if (!covered || n <= 0) return 0
  return cfg.gas * 2 * n
}

/** Sum over a wallet list. Extra-rent refunds count only when the user turned them on (`withExcess`). */
export function bulkTotals(
  rows: ScanEstimate[],
  dest: Destination,
  fees: { feeDirect: number; feeBalance: number; gas?: number; txPerBatch?: number; treasuryPaysGas?: boolean },
  withExcess = false,
): Totals {
  return rows.reduce<Totals>(
    (a, r) => {
      const x = totals(r, dest, 'keep', false, fees, withExcess
        ? { excessSol: r.excessSol, excessBoxes: r.excess }
        : {})
      return { fee: x.fee, gross: a.gross + x.gross, feeSol: a.feeSol + x.feeSol, bonus: 0, net: a.net + x.net, boxes: a.boxes + x.boxes }
    },
    { fee: 0, gross: 0, feeSol: 0, bonus: 0, net: 0, boxes: 0 },
  )
}
