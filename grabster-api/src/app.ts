import express from 'express'
import cors from 'cors'
import { ZodError } from 'zod'
import { env } from './shared/env'
import { initDb } from './shared/db'
import { loadSinkAllow } from './shared/sink-allow'
import { configRouter } from './modules/config/handler'
import { scanRouter } from './modules/scan/handler'
import { planRouter } from './modules/plan/handler'
import { submitRouter } from './modules/submit/handler'
import { authRouter } from './modules/auth/handler'
import { balanceRouter } from './modules/balance/handler'
import { refRouter } from './modules/ref/handler'
import { partnerRouter } from './modules/partner/handler'
import { attachMcpKey, mcpRouterHandlers } from './modules/partner/mcp'
import { requirePartner } from './modules/partner/guard'
import { opsRouter } from './modules/ops/handler'
import { startSwpLoop } from './modules/swp/job'
import { settlePending } from './modules/balance/service'
import { ensureCleanupTable } from './shared/cleanup'
import './shared/referral' // registers ledger → markGrabbed when a referral credit becomes available

const app = express()
// Session cookies only for the site's own origins once ALLOWED_ORIGINS is set; key-based and public
// routes stay callable from anywhere, without credentials.
const exposedHeaders = ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After']
app.use(cors((req, cb) => {
  const origin = req.header('Origin')
  if (!env.allowedOrigins.length) return cb(null, { origin: true, credentials: true, exposedHeaders })
  if (origin && env.allowedOrigins.includes(origin)) return cb(null, { origin, credentials: true, exposedHeaders })
  cb(null, { origin: '*', credentials: false, exposedHeaders })
}))

// CORS stops other sites from reading responses, not from sending simple POSTs. With an allowlist set,
// refuse state-changing requests that ride on the session cookie from any other origin.
// Bearer (partner key or access token) is an explicit credential and may be sent cross-origin; junk
// Authorization must not unlock the cookie session — see sessionAddress().
app.use((req, res, next) => {
  if (!env.allowedOrigins.length || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  const origin = req.header('Origin')
  if (!origin || env.allowedOrigins.includes(origin)) return next()
  const auth = req.header('authorization') || ''
  if (auth.startsWith('Bearer ')) return next()
  if (!/(?:^|;\s*)grabster_(?:at|rt)=/.test(req.header('cookie') || '')) return next()
  res.status(403).json({ error: 'Cross-site request refused.' })
})

if (!env.allowedOrigins.length && process.env.COOKIE_SECURE === '1') {
  console.warn('SECURITY: COOKIE_SECURE=1 but ALLOWED_ORIGINS is empty — any site can make signed-in requests. Set ALLOWED_ORIGINS.')
}
app.use(express.json({ limit: '2mb' }))

app.get('/health', (_req, res) => res.json({ ok: true }))
app.use('/v1/config', configRouter)
app.use('/v1/scan', scanRouter)
app.use('/v1/plan', planRouter)
app.use('/v1/submit', submitRouter)
app.use('/v1/auth', authRouter)
app.use('/v1/balance', balanceRouter)
app.use('/v1/ref', refRouter)
app.use('/v1/partner', partnerRouter)
app.use('/v1/ops', opsRouter)
app.get('/mcp', mcpRouterHandlers)
app.delete('/mcp', mcpRouterHandlers)
app.post('/mcp', attachMcpKey, requirePartner, mcpRouterHandlers)

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: err.issues[0]?.message || 'Invalid request.' })
    return
  }
  let status = typeof err === 'object' && err && 'status' in err ? Number((err as { status: number }).status) : 500
  let message = err instanceof Error ? err.message : 'Server error'
  if (/^fetch failed$/i.test(message)) {
    message = 'Could not reach the Solana RPC. Try again in a moment.'
    if (!status || status === 500) status = 502
  }
  const payload: { error: string; code?: string; signatures?: string[] } = { error: message }
  if (typeof err === 'object' && err) {
    if ('code' in err && typeof (err as { code: unknown }).code === 'string') payload.code = (err as { code: string }).code
    if ('signatures' in err && Array.isArray((err as { signatures: unknown }).signatures)) {
      payload.signatures = (err as { signatures: string[] }).signatures
    }
  }
  console.error(err)
  res.status(status || 500).json(payload)
})

const ready = await initDb()
if (ready) {
  await loadSinkAllow()
  await ensureCleanupTable()
}

app.listen(env.port, () => {
  console.log(`grabster-api on http://localhost:${env.port}`)
  startSwpLoop()
  // Settle pending ledger rows even when nobody opens a balance page.
  if (ready) setInterval(() => { void settlePending().catch(() => {}) }, 60_000).unref()
})
