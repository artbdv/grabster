import { Router } from 'express'
import { z } from 'zod'
import { rpc, withRpc } from '../../shared/rpc'
import { requireSession } from '../../shared/session'
import { getPlan } from '../plan/store'
import { submitPlan } from './service'

export const submitRouter = Router()

const Body = z.object({
  planId: z.string().min(8),
  txs: z.array(z.string().min(20)).min(1),
  ref: z.string().min(6).max(48).optional(),
  channel: z.enum(['web', 'batch']).optional(),
})

submitRouter.post('/', async (req, res, next) => {
  try {
    const body = Body.parse(req.body)
    const plan = getPlan(body.planId)
    const creditOwner = plan?.dest === 'balance' ? requireSession(req) : undefined
    res.json(await submitPlan(body.planId, body.txs, body.ref, creditOwner, body.channel || 'web'))
  } catch (err) {
    next(err)
  }
})

/** Soft per-client limit: a run polls every few seconds, nothing legitimate needs more. */
const STATUS_PER_MIN = 300
const statusHits = new Map<string, number[]>()

function statusSlot(client: string): boolean {
  const now = Date.now()
  const recent = (statusHits.get(client) || []).filter((at) => now - at < 60_000)
  if (recent.length >= STATUS_PER_MIN) {
    statusHits.set(client, recent)
    return false
  }
  recent.push(now)
  statusHits.set(client, recent)
  return true
}

setInterval(() => {
  const now = Date.now()
  for (const [k, v] of statusHits) if (!v.some((at) => now - at < 60_000)) statusHits.delete(k)
}, 60_000).unref()

const StatusBody = z.object({
  signatures: z.array(z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/, 'Invalid signature.')).min(1).max(100),
})

/** Read-only: where submitted transactions stand on chain (pending / confirmed / failed). */
submitRouter.post('/status', async (req, res, next) => {
  try {
    // The rightmost X-Forwarded-For hop is the one our own proxy appended; earlier hops are client-supplied.
    const client = String(req.header('x-forwarded-for') || '').split(',').pop()?.trim() || req.ip || 'unknown'
    if (!statusSlot(client)) {
      res.set('Retry-After', '30').status(429).json({ error: 'Too many status checks. Try again shortly.' })
      return
    }
    const { signatures } = StatusBody.parse(req.body)
    const result = await withRpc(() => rpc().getSignatureStatuses(signatures, { searchTransactionHistory: true }))
    const statuses = signatures.map((signature, i) => {
      const st = result.value[i]
      if (st?.err) return { signature, state: 'failed' as const, error: JSON.stringify(st.err) }
      if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
        return { signature, state: 'confirmed' as const }
      }
      return { signature, state: 'pending' as const }
    })
    res.json({ statuses })
  } catch (err) {
    next(err)
  }
})
