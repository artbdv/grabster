import { ESTIMATED_GAS_SOL, lamportsToSol, TX_PER_BATCH, type PublicConfig } from '@grabster/solana-core'
import { env } from '../../shared/env'
import { fetchSolUsd } from '../../shared/jupiter'
import { tokenAccountRent } from '../../shared/rent'
import { PARTNER_BATCH_MAX } from '../partner/handler'
import { PLAN_TTL_MS } from '../plan/store'
import { SCAN_BATCH_MAX } from '../scan/service'

export async function getPublicConfig(): Promise<PublicConfig> {
  const [rentNow, solUsd] = await Promise.all([
    tokenAccountRent(),
    fetchSolUsd().catch(() => 0),
  ])
  return {
    feeDirect: env.treasury ? env.feeDirect : 0,
    feeBalance: env.feeBalance,
    gas: ESTIMATED_GAS_SOL,
    rentNow: lamportsToSol(rentNow),
    txPerBatch: TX_PER_BATCH,
    refShare: env.refShare,
    demoAddress: env.demoAddress,
    treasury: env.treasury,
    treasuryPaysGas: Boolean(env.treasury && env.treasurySecret),
    keepAboveUsd: env.keepAboveUsd,
    dustShare: env.dustShare,
    withdrawMinSol: env.withdrawMinSol,
    withdrawFeeSol: env.withdrawFeeSol,
    withdrawDailySol: env.withdrawDailySol,
    solUsd,
    limits: {
      partnerPerMin: env.partnerRatePerMin,
      partnerBatch: PARTNER_BATCH_MAX,
      scanBatch: SCAN_BATCH_MAX,
      planTtlSec: Math.round(PLAN_TTL_MS / 1000),
    },
    features: {
      balance: env.features.balance,
      sweep: Boolean(env.features.sweep && env.treasury && env.treasurySecret),
      nftBurn: env.features.nftBurn,
      excessRent: env.features.excessRent,
      referrals: env.features.referrals,
    },
  }
}
