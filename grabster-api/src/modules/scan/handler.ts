import { Router } from 'express'
import { PublicKey } from '@solana/web3.js'
import { z } from 'zod'
import { lamportsToSol } from '@grabster/solana-core'
import { rpc } from '../../shared/rpc'
import { SCAN_BATCH_MAX, scanAddress, scanAddresses } from './service'

export const scanRouter = Router()

scanRouter.post('/', async (req, res, next) => {
  try {
    const body = z.object({
      addresses: z.array(z.string().min(1).max(128)).min(1).max(SCAN_BATCH_MAX),
    }).parse(req.body)
    res.json({ rows: await scanAddresses(body.addresses) })
  } catch (err) {
    next(err)
  }
})

scanRouter.get('/:address/balance', async (req, res, next) => {
  try {
    const address = String(req.params.address || '').trim()
    try {
      new PublicKey(address)
    } catch {
      res.status(400).json({ error: 'Invalid Solana address.' })
      return
    }
    const lamports = await rpc().getBalance(new PublicKey(address))
    res.json({ address, lamports, sol: lamportsToSol(lamports) })
  } catch (err) {
    next(err)
  }
})

scanRouter.get('/:address', async (req, res, next) => {
  try {
    const address = String(req.params.address || '').trim()
    try {
      new PublicKey(address)
    } catch {
      res.status(400).json({ error: 'Invalid Solana address.' })
      return
    }
    const result = await scanAddress(address)
    res.json({ address: result.address, estimate: result.estimate, boxes: result.boxes, rentNow: result.rentNow })
  } catch (err) {
    next(err)
  }
})
