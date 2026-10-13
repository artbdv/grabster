export type BoxKind = 'empty' | 'dust' | 'nft' | 'frozen' | 'keep'
export type Destination = 'same' | 'other' | 'balance'
export type DustMode = 'burn' | 'give' | 'keep'
export type InputKind = 'address' | 'key' | 'seed' | 'connected' | ''
export type PlannedTxType = 'CLOSE' | 'BURN' | 'SWEEP' | 'NFT' | 'REFUND'

export interface TokenBox {
  address: string
  mint: string
  program: 'token' | 'token2022'
  amount: string
  decimals: number
  lamports: number
  extraLamports: number
  space: number
  excessLamports: number
  frozen: boolean
  native: boolean
  delegate: string
  extensions: string[]
  symbol: string
  logo: string
  usdPrice: number
  valueUsd: number
  liquidityUsd: number
  hasPrice: boolean
  listed: boolean
  netValueUsd: number
  transferFeeBps: number
  sweepable: boolean
  collection: string
  collectionVerified: boolean
  nftBurnable: boolean
  tokenStandard: number | null
  ruleSet: string
  kind: BoxKind
}

export interface ScanEstimate {
  addr: string
  kind?: InputKind
  empty: number
  dust: number
  nft: number
  frozen: number
  keep: number
  rent: number
  dustValue: number
  noSol: boolean
  sol: number
  emptySol: number
  dustSol: number
  nftSol: number
  solUsd: number
  sweep: number
  excess: number
  excessSol: number
}

export interface ScanResponse {
  address: string
  estimate: ScanEstimate
  boxes: TokenBox[]
  rentNow: number
}

export interface BatchScanRow {
  address: string
  estimate: ScanEstimate
  error?: string
}

export interface BatchScanResponse {
  rows: BatchScanRow[]
}

export interface PublicConfig {
  feeDirect: number
  feeBalance: number
  gas: number
  rentNow: number
  txPerBatch: number
  refShare: number
  demoAddress: string
  treasury: string
  treasuryPaysGas: boolean
  keepAboveUsd: number
  dustShare: number
  withdrawMinSol: number
  withdrawFeeSol: number
  withdrawDailySol: number
  solUsd: number
  /** Live limits, so docs show what the server enforces. */
  limits?: {
    partnerPerMin: number
    partnerBatch: number
    scanBatch: number
    planTtlSec: number
  }
  features: {
    balance: boolean
    sweep: boolean
    nftBurn: boolean
    excessRent: boolean
    referrals: boolean
  }
}

export interface PlannedTx {
  id: string
  type: PlannedTxType
  tx: string
  messageHash: string
  description: {
    closes: number
    burns: number
    sweeps: number
    nfts: number
    refunds: number
    closeAccounts: string[]
    burnAccounts: string[]
    sweepAccounts: string[]
    sinkAtas: string[]
    nftAccounts: string[]
    nftMetas: string[]
    nftEditions: string[]
    refundAccounts: string[]
    closeDestination: string
    feeTo: string
    feeLamports: number
    remainderTo?: string
    remainderLamports?: number
    creditTo?: string
    creditLamports?: number
    recoveredLamports: number
    /** Grabster's fee inside feeLamports; the rest of feeLamports is network fee withheld when the treasury pays. */
    serviceFeeLamports?: number
    /** Leftover credit booked to the Grabster balance (dest balance). Ledger only — not a transfer in this tx. */
    balanceCreditLamports?: number
  }
}

export interface PlanResponse {
  planId: string
  address: string
  dest: Destination
  destination: string
  feePayer: string
  needsTreasurySig: boolean
  feeLamports: number
  netLamports: number
  recoveredLamports: number
  txs: PlannedTx[]
}

export interface SubmitResponse {
  signatures: string[]
}
