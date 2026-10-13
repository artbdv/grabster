import { config as loadDotenv } from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
loadDotenv({ path: resolve(here, '../../.env') })
loadDotenv({ path: resolve(here, '../../../.env') })

function partnerKeys(raw: string): { name: string; secret: string }[] {
  const out: { name: string; secret: string }[] = []
  for (const row of raw.split(',')) {
    const trimmed = row.trim()
    if (!trimmed) continue
    const cut = trimmed.indexOf(':')
    const name = cut === -1 ? `partner-${out.length + 1}` : (trimmed.slice(0, cut).trim() || `partner-${out.length + 1}`)
    const secret = (cut === -1 ? trimmed : trimmed.slice(cut + 1)).trim()
    if (secret.length < 16) continue
    out.push({ name, secret })
  }
  return out
}

function ttlMs(raw: string, fallback: number): number {
  const m = String(raw || '').trim().match(/^(\d+)\s*(ms|s|m|h|d)$/i)
  if (!m) return fallback
  const n = Number(m[1])
  const unit = m[2].toLowerCase()
  if (unit === 'ms') return n
  if (unit === 's') return n * 1000
  if (unit === 'm') return n * 60_000
  if (unit === 'h') return n * 3_600_000
  return n * 86_400_000
}

export const env = {
  port: Number(process.env.API_PORT || process.env.PORT || 8787),
  rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  treasury: (process.env.TREASURY_ADDRESS || '').trim(),
  treasurySecret: (process.env.TREASURY_SECRET || '').trim(),
  demoAddress: (process.env.DEMO_ADDRESS || '').trim(),
  feeDirect: Number(process.env.FEE_DIRECT || 1),
  feeBalance: Number(process.env.FEE_BALANCE || 0.5),
  jupiterKey: (process.env.JUPITER_API_KEY || '').trim(),
  keepAboveUsd: Number(process.env.KEEP_ABOVE_USD || 5),
  dustShare: Math.min(100, Math.max(0, Number(process.env.DUST_SHARE || 50) || 50)),
  dbUser: (process.env.DB_USER || 'postgres').trim(),
  dbHost: (process.env.DB_HOST || 'localhost').trim(),
  dbName: (process.env.DB_NAME || 'grabster').trim(),
  dbPassword: process.env.DB_PASSWORD || '1234',
  dbPort: Number(process.env.DB_PORT || 5432),
  swpIntervalMs: Number(process.env.SWP_INTERVAL_MS || 15 * 60 * 1000),
  swpStartDelayMs: Number(process.env.SWP_START_DELAY_MS || 60_000),
  swpFailsBeforeBurn: Math.max(1, Number(process.env.SWP_FAILS_BEFORE_BURN || 3) || 3),
  accessSignKey: (process.env.SECRET_ACCESS_SIGN_KEY || process.env.SESSION_SECRET || 'grabster-dev-access').trim(),
  refreshSignKey: (process.env.SECRET_REFRESH_SIGN_KEY || process.env.SECRET_ACCESS_SIGN_KEY || process.env.SESSION_SECRET || 'grabster-dev-refresh').trim(),
  accessTtlMs: ttlMs(process.env.ACCESS_TOKEN_TTL || '', 30 * 60_000),
  refreshTtlMs: ttlMs(process.env.REFRESH_TOKEN_TTL || '', 720 * 3_600_000),
  vault: (process.env.VAULT_ADDRESS || process.env.TREASURY_ADDRESS || '').trim(),
  vaultSecret: (process.env.VAULT_SECRET || process.env.TREASURY_SECRET || '').trim(),
  withdrawMinSol: Number(process.env.WITHDRAW_MIN_SOL || 0.01),
  withdrawFeeSol: Number(process.env.WITHDRAW_FEE_SOL || 0),
  withdrawDailySol: Number(process.env.WITHDRAW_DAILY_SOL || 5),
  refShare: Math.min(100, Math.max(0, Number(process.env.REF_SHARE || 25) || 25)),
  refDays: Math.max(1, Number(process.env.REF_DAYS || 30) || 30),
  partnerKeys: partnerKeys(process.env.PARTNER_API_KEYS || ''),
  partnerRatePerMin: Math.min(600, Math.max(1, Number(process.env.PARTNER_RATE_PER_MIN || 60) || 60)),
  /** Site origins allowed to call the API with the user's session (comma-separated). Empty = any origin (legacy). */
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean),
  features: {
    balance: process.env.FEATURE_BALANCE === '1',
    sweep: process.env.FEATURE_SWEEP !== '0',
    nftBurn: process.env.FEATURE_NFT_BURN !== '0',
    excessRent: process.env.FEATURE_EXCESS_RENT !== '0',
    swp: process.env.FEATURE_SWP !== '0',
    referrals: process.env.FEATURE_REFERRALS !== '0',
  },
}
