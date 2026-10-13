import { Router } from 'express'
import { z } from 'zod'
import {
  challengeMessage,
  clearAuthCookies,
  issuePair,
  refreshFrom,
  revokeRefresh,
  rotateRefresh,
  sessionAddress,
  verifySiws,
  writeAuthCookies,
} from '../../shared/session'

export const authRouter = Router()

authRouter.get('/challenge', (req, res) => {
  const address = z.string().min(32).parse(req.query.address)
  res.json({ address, message: challengeMessage(address) })
})

authRouter.post('/verify', (req, res) => {
  const body = z.object({
    address: z.string().min(32),
    message: z.string().min(8),
    signature: z.string().min(32),
  }).parse(req.body)
  if (!verifySiws(body.address, body.message, body.signature)) {
    res.status(401).json({ error: 'That signature does not match this address.' })
    return
  }
  const pair = issuePair(body.address)
  writeAuthCookies(res, pair.accessToken, pair.refreshToken)
  res.json(pair)
})

authRouter.post('/refresh', (req, res) => {
  const token = refreshFrom(req, typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : '')
  const pair = token ? rotateRefresh(token) : null
  if (!pair) {
    clearAuthCookies(res)
    res.status(401).json({ error: 'Session expired. Log in again.' })
    return
  }
  writeAuthCookies(res, pair.accessToken, pair.refreshToken)
  res.json(pair)
})

authRouter.post('/logout', (req, res) => {
  revokeRefresh(refreshFrom(req, typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : ''))
  clearAuthCookies(res)
  res.json({ ok: true })
})

authRouter.get('/me', (req, res) => {
  const address = sessionAddress(req)
  if (!address) {
    res.status(401).json({ error: 'Not signed in.' })
    return
  }
  res.json({ address })
})
