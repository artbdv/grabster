import { isProtectedMint } from './protected'
import type { BoxKind } from './types'

export function classifyBox(input: {
  amount: bigint
  decimals: number
  frozen: boolean
  native: boolean
  mint: string
}): BoxKind {
  if (input.native) return 'empty'
  if (input.amount === 0n) return 'empty'
  if (isProtectedMint(input.mint)) return 'keep'
  if (input.decimals === 0 && input.amount === 1n) return 'nft'
  if (input.frozen) return 'frozen'
  return 'dust'
}
