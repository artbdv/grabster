export const PROGRAMS = {
  SYSTEM: '11111111111111111111111111111111',
  TOKEN: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  TOKEN_2022: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  ATA: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  COMPUTE: 'ComputeBudget111111111111111111111111111111',
  METADATA: 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
  MEMO: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
} as const

export const ALLOWED_PROGRAMS = new Set<string>(Object.values(PROGRAMS))
/** Phantom / Solflare inject assertion ixs at sign time. Not part of our plan. */
export const LIGHTHOUSE_PROGRAM = 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95'

export const WSOL_MINT = 'So11111111111111111111111111111111111111112'

export const TX_SIZE_LIMIT = 1232
export const TX_SIZE_SAFE = 1180
export const TX_PER_BATCH = 25
/** Sweep pairs (transfer + close, optional ATA) are heavier than a bare close. */
export const SWEEP_PER_BATCH = 10
/** Metaplex BurnNft / Burn V1 close token + metadata + edition (+ token record for pNFT). TZ: 3–5 per tx. */
export const NFT_PER_BATCH = 4
/** WithdrawExcessLamports is small; pack more per tx. */
export const REFUND_PER_BATCH = 20
export const WITHDRAW_EXCESS_DISCRIMINATOR = 38
export const BASE_FEE_LAMPORTS = 5000
export const LAMPORTS_PER_SOL = 1_000_000_000
/** Below this, treasury may pay the network fee if the wallet cannot stay rent-exempt. */
export const MIN_FEE_PAYER_LAMPORTS = 10_000
export const ESTIMATED_GAS_SOL = 0.0002
/** POL-4: leftovers at or above this USD value stay Keep. */
export const KEEP_ABOVE_USD = 5
/** POL-1: share of estimated leftover value credited back in SOL. */
export const DUST_SHARE = 50
