import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Router } from 'express'
import { PublicKey } from '@solana/web3.js'
import { z } from 'zod'
import { env } from '../../shared/env'
import { SCAN_BATCH_MAX, scanAddress, scanAddresses } from '../scan/service'
import { buildPlan } from '../plan/service'
import { getPlan } from '../plan/store'
import { submitPlan } from '../submit/service'
import { sessionAddress } from '../../shared/session'
import { rejectSecrets, requirePartner } from './guard'
import { issuePartnerKey, rotatePartnerKey } from './keys'

const specPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../openapi/partner-v1.yaml')
const spec = readFileSync(specPath, 'utf8')

/** Smaller than the first-party batch so one partner key cannot drain the RPC. */
export const PARTNER_BATCH_MAX = Math.min(25, SCAN_BATCH_MAX)

export const partnerRouter = Router()

partnerRouter.get('/openapi.yaml', (_req, res) => {
  res.type('application/yaml').send(spec)
})

partnerRouter.get('/key', async (req, res, next) => {
  try {
    const owner = sessionAddress(req)
    if (!owner) {
      res.status(401).json({ error: 'Sign in to get an API key.' })
      return
    }
    res.json(await issuePartnerKey(owner))
  } catch (err) {
    next(err)
  }
})

partnerRouter.post('/key/rotate', async (req, res, next) => {
  try {
    const owner = sessionAddress(req)
    if (!owner) {
      res.status(401).json({ error: 'Sign in to get an API key.' })
      return
    }
    res.json(await rotatePartnerKey(owner))
  } catch (err) {
    next(err)
  }
})

partnerRouter.use(requirePartner)

const account = z.string().min(32).max(44)

const PlanBody = z.object({
  address: account,
  dest: z.enum(['same', 'other'], { errorMap: () => ({ message: 'dest must be same or other. Balance is not available on the partner API.' }) }),
  other: z.string().optional(),
  burnDust: z.boolean().optional(),
  burnAccounts: z.array(account).optional(),
  sweepAccounts: z.array(account).optional(),
  burnNft: z.boolean().optional(),
  nftAccounts: z.array(account).optional(),
  refundExcess: z.boolean().optional(),
  refundAccounts: z.array(account).optional(),
})

partnerRouter.get('/me', (_req, res) => {
  res.json({ name: res.locals.partnerName || 'partner' })
})

partnerRouter.get('/scan/:address', async (req, res, next) => {
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

partnerRouter.post('/scan', async (req, res, next) => {
  try {
    rejectSecrets(req.body)
    const body = z.object({
      addresses: z.array(z.string().min(1).max(128)).min(1).max(PARTNER_BATCH_MAX),
    }).parse(req.body)
    res.json({ rows: await scanAddresses(body.addresses) })
  } catch (err) {
    next(err)
  }
})

partnerRouter.post('/plan', async (req, res, next) => {
  try {
    rejectSecrets(req.body)
    const body = PlanBody.parse(req.body)
    if (body.dest === 'other' && body.other === env.treasury) {
      res.status(400).json({ error: 'Destination cannot be the treasury.' })
      return
    }
    const plan = await buildPlan({
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
    })
    for (const tx of plan.txs) {
      if (tx.description.feeLamports > 0 && tx.description.feeTo !== env.treasury) {
        throw Object.assign(new Error('Refusing to return a plan whose fee does not go to Grabster.'), { status: 500 })
      }
    }
    res.json(plan)
  } catch (err) {
    next(err)
  }
})

partnerRouter.post('/submit', async (req, res, next) => {
  try {
    rejectSecrets(req.body)
    const body = z.object({
      planId: z.string().min(8),
      txs: z.array(z.string().min(20)).min(1),
    }).parse(req.body)
    const plan = getPlan(body.planId)
    if (plan?.dest === 'balance') {
      res.status(400).json({ error: 'Balance destination is not available on the partner API.' })
      return
    }
    res.json(await submitPlan(body.planId, body.txs, undefined, undefined, 'api'))
  } catch (err) {
    next(err)
  }
})
