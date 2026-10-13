import { DUST_SHARE } from './programs'
import type { TokenBox } from './types'

function extensionsText(box: TokenBox): string {
  return box.extensions.join(' ').toLowerCase()
}

export function hasTransferHook(box: TokenBox): boolean {
  return box.program === 'token2022' && extensionsText(box).includes('transferhook')
}

/** Non-transferable mints cannot go to a sink. TransferHook can, after extra accounts resolve. */
export function isTransferableBox(box: TokenBox): boolean {
  return !extensionsText(box).includes('nontransferable')
}

/** Dust we may move to Grabster: live Jupiter quote, or a mint already on the sink list. */
export function isSweepableBox(box: TokenBox): boolean {
  if (box.kind !== 'dust' || box.native) return false
  if (box.delegate) return false
  if (!isTransferableBox(box)) return false
  if (box.hasPrice && box.valueUsd > 0 && box.liquidityUsd > 0) return true
  return Boolean(box.listed)
}

export function sweepValueUsd(box: TokenBox): number {
  if (box.netValueUsd > 0) return box.netValueUsd
  return box.valueUsd
}

/** SOL credited for leftovers the user gives (dustShare is 0–100). */
export function sweepCreditSol(valueUsd: number, solUsd: number, dustShare = DUST_SHARE): number {
  if (solUsd <= 0 || valueUsd <= 0 || dustShare <= 0) return 0
  return (valueUsd * dustShare) / 100 / solUsd
}

/** Opening a sink ATA is worth it when the credit covers current ATA rent. */
export function ataCreateJustified(
  valueUsd: number,
  rentNowSol: number,
  solUsd: number,
  dustShare = DUST_SHARE,
): boolean {
  if (valueUsd <= 0) return false
  const sol = solUsd > 0 ? solUsd : 100
  return (valueUsd * dustShare) / 100 >= rentNowSol * sol
}
