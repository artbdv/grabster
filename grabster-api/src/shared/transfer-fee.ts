import { PublicKey } from '@solana/web3.js'
import { TOKEN_2022_PROGRAM_ID, calculateFee, getTransferFeeConfig, unpackMint } from '@solana/spl-token'
import type { TokenBox } from '@grabster/solana-core'
import { rpc, withRpc } from './rpc'

function hasTransferFee(box: TokenBox): boolean {
  return box.program === 'token2022' && box.extensions.join(' ').toLowerCase().includes('transferfee')
}

/** Net leftover value after Token-2022 transfer fee — credit is paid on what the sink actually receives. */
export async function attachTransferFees(boxes: TokenBox[]): Promise<void> {
  for (const box of boxes) {
    if (!box.netValueUsd) box.netValueUsd = box.valueUsd
  }
  const need = boxes.filter((b) => b.kind === 'dust' && hasTransferFee(b) && b.valueUsd > 0)
  if (!need.length) return
  const unique = [...new Map(need.map((b) => [b.mint, b])).values()]
  const infos = await withRpc(() => rpc().getMultipleAccountsInfo(unique.map((b) => new PublicKey(b.mint))))
  const feeByMint = new Map<string, { bps: number; withheld: (amount: bigint) => bigint }>()
  unique.forEach((box, i) => {
    const info = infos[i]
    if (!info) return
    try {
      const mint = unpackMint(new PublicKey(box.mint), info, TOKEN_2022_PROGRAM_ID)
      const cfg = getTransferFeeConfig(mint)
      if (!cfg) return
      const row = cfg.newerTransferFee
      feeByMint.set(box.mint, {
        bps: row.transferFeeBasisPoints,
        withheld: (amount) => calculateFee(row, amount),
      })
    } catch { /* ignore unreadable mint */ }
  })
  for (const box of need) {
    const fee = feeByMint.get(box.mint)
    if (!fee || fee.bps <= 0) continue
    const amount = BigInt(box.amount || '0')
    if (amount <= 0n) continue
    const net = amount - fee.withheld(amount)
    box.transferFeeBps = fee.bps
    box.netValueUsd = net > 0n ? box.valueUsd * Number(net) / Number(amount) : 0
  }
}
