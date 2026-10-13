import { Router } from 'express'
import { z } from 'zod'
import { opsSnapshot, type OpsPeriod } from '../../shared/cleanup'

export const opsRouter = Router()

const Period = z.enum(['7d', '30d', '90d'])

opsRouter.get('/', async (req, res, next) => {
  try {
    const period = Period.parse(req.query.period || '30d') as OpsPeriod
    res.json(await opsSnapshot(period))
  } catch (err) {
    next(err)
  }
})
