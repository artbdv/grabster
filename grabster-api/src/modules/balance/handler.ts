import { Router } from 'express'
import { z } from 'zod'
import { env } from '../../shared/env'
import { sessionAddress } from '../../shared/session'
import { balanceOf } from './service'
import { withdrawToOwner } from './withdraw'

export const balanceRouter = Router()

function signedIn(req: { header: (n: string) => unknown }): string {
  if (!env.features.balance) {
    throw Object.assign(new Error('Grabster balance is not enabled.'), { status: 404 })
  }
  const address = sessionAddress(req)
  if (!address) {
    throw Object.assign(new Error('Sign in with your wallet to see this balance.'), { status: 401 })
  }
  return address
}

balanceRouter.get('/', async (req, res, next) => {
  try {
    res.json(await balanceOf(signedIn(req)))
  } catch (err) {
    next(err)
  }
})

balanceRouter.post('/withdraw', async (req, res, next) => {
  try {
    const address = signedIn(req)
    const body = z.object({ sol: z.number().positive() }).parse(req.body)
    res.json(await withdrawToOwner(address, body.sol))
  } catch (err) {
    next(err)
  }
})
