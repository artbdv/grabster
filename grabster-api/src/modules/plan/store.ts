import { randomBytes } from 'node:crypto'
import type { PlanResponse } from '@grabster/solana-core'

export const PLAN_TTL_MS = 90_000
const TTL = PLAN_TTL_MS
const plans = new Map<string, { at: number; plan: PlanResponse }>()

setInterval(() => {
  const now = Date.now()
  for (const [id, row] of plans) {
    if (now - row.at > TTL) plans.delete(id)
  }
}, 30_000).unref()

export function putPlan(plan: Omit<PlanResponse, 'planId'>): PlanResponse {
  const planId = randomBytes(16).toString('hex')
  const full = { ...plan, planId }
  plans.set(planId, { at: Date.now(), plan: full })
  return full
}

export function getPlan(planId: string): PlanResponse | null {
  const row = plans.get(planId)
  if (!row) return null
  if (Date.now() - row.at > TTL) {
    plans.delete(planId)
    return null
  }
  return row.plan
}
