import { Router } from 'express'
import { getPublicConfig } from './service'

export const configRouter = Router()

configRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await getPublicConfig())
  } catch (err) {
    next(err)
  }
})
