import { Router } from 'express'
import { env } from '../../shared/env'
import { sessionAddress } from '../../shared/session'
import { leaders, mineOf } from '../../shared/referral'

export const refRouter = Router()

refRouter.get('/leaders', async (req, res, next) => {
  try {
    if (!env.features.referrals) {
      res.json({ rows: [], you: null })
      return
    }
    const you = sessionAddress(req) || undefined
    res.json(await leaders(you))
  } catch (err) {
    next(err)
  }
})

refRouter.get('/me', async (req, res, next) => {
  try {
    if (!env.features.referrals) {
      res.status(404).json({ error: 'Referrals are not enabled.' })
      return
    }
    const address = sessionAddress(req)
    if (!address) {
      res.status(401).json({ error: 'Sign in with your wallet to get a link.' })
      return
    }
    res.json(await mineOf(address))
  } catch (err) {
    next(err)
  }
})
