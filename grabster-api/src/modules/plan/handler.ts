import { Router } from 'express'
import { z } from 'zod'
import { requireSession } from '../../shared/session'
import { buildPlan } from './service'

export const planRouter = Router()

const Body = z.object({
  address: z.string().min(32).max(44),
  dest: z.enum(['same', 'other', 'balance']),
  other: z.string().optional(),
  burnDust: z.boolean().optional(),
  burnAccounts: z.array(z.string().min(32).max(44)).optional(),
  sweepAccounts: z.array(z.string().min(32).max(44)).optional(),
  burnNft: z.boolean().optional(),
  nftAccounts: z.array(z.string().min(32).max(44)).optional(),
  refundExcess: z.boolean().optional(),
  refundAccounts: z.array(z.string().min(32).max(44)).optional(),
})

planRouter.post('/', async (req, res, next) => {
  try {
    const body = Body.parse(req.body)
    if (body.dest === 'balance') requireSession(req)
    res.json(await buildPlan({
      address: body.address,
      dest: body.dest,
      other: body.other,
      burnDust: !!body.burnDust,
      burnAccounts: body.burnAccounts,
      sweepAccounts: body.sweepAccounts,
      burnNft: !!body.burnNft,
      nftAccounts: body.nftAccounts,
      refundExcess: !!body.refundExcess,
      refundAccounts: body.refundAccounts,
    }))
  } catch (err) {
    next(err)
  }
})
