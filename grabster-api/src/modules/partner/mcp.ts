import type { Request, Response } from 'express'
import { PublicKey } from '@solana/web3.js'
import { z, ZodError } from 'zod'
import { env } from '../../shared/env'
import { scanAddress, scanAddresses } from '../scan/service'
import { buildPlan } from '../plan/service'
import { getPlan } from '../plan/store'
import { submitPlan } from '../submit/service'
import { rejectSecrets } from './guard'

const account = z.string().min(32).max(44)

const PlanArgs = z.object({
  address: account,
  dest: z.enum(['same', 'other']),
  other: z.string().optional(),
  burnDust: z.boolean().optional(),
  burnAccounts: z.array(account).optional(),
  sweepAccounts: z.array(account).optional(),
  burnNft: z.boolean().optional(),
  nftAccounts: z.array(account).optional(),
  refundExcess: z.boolean().optional(),
  refundAccounts: z.array(account).optional(),
})

const tools = [
  {
    name: 'scan_address',
    description: 'Scan one Solana wallet for reclaimable rent. Never pass a private key or seed.',
    inputSchema: {
      type: 'object',
      properties: { address: { type: 'string', description: 'Wallet address' } },
      required: ['address'],
    },
  },
  {
    name: 'scan_batch',
    description: 'Scan up to 25 Solana wallets. Never pass private keys or seeds.',
    inputSchema: {
      type: 'object',
      properties: {
        addresses: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 25 },
      },
      required: ['addresses'],
    },
  },
  {
    name: 'plan_reclaim',
    description: 'Build unsigned reclaim transactions. The wallet owner signs them. dest is same or other. Do not pass a private key.',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string' },
        dest: { type: 'string', enum: ['same', 'other'] },
        other: { type: 'string', description: 'Recipient when dest is other' },
        burnDust: { type: 'boolean' },
        refundExcess: { type: 'boolean' },
      },
      required: ['address', 'dest'],
    },
  },
  {
    name: 'submit_signed',
    description: 'Send owner-signed transactions for a plan Grabster already built. Pass the signed transaction bytes, never a private key.',
    inputSchema: {
      type: 'object',
      properties: {
        planId: { type: 'string' },
        txs: { type: 'array', items: { type: 'string' }, minItems: 1 },
      },
      required: ['planId', 'txs'],
    },
  },
]

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

function toolText(data: unknown, isError = false) {
  return {
    content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
    ...(isError ? { isError: true } : {}),
  }
}

function validAddress(address: string) {
  try {
    new PublicKey(address)
    return true
  } catch {
    return false
  }
}

async function runTool(name: string, args: unknown) {
  rejectSecrets(args)
  if (name === 'scan_address') {
    const { address } = z.object({ address: account }).parse(args)
    if (!validAddress(address)) return toolText('Invalid Solana address.', true)
    const result = await scanAddress(address)
    return toolText({ address: result.address, estimate: result.estimate, boxes: result.boxes, rentNow: result.rentNow })
  }
  if (name === 'scan_batch') {
    const { addresses } = z.object({
      addresses: z.array(z.string().min(1).max(128)).min(1).max(25),
    }).parse(args)
    return toolText({ rows: await scanAddresses(addresses) })
  }
  if (name === 'plan_reclaim') {
    const body = PlanArgs.parse(args)
    if (body.dest === 'other' && body.other === env.treasury) return toolText('Destination cannot be the treasury.', true)
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
        return toolText('Refusing to return a plan whose fee does not go to Grabster.', true)
      }
    }
    return toolText(plan)
  }
  if (name === 'submit_signed') {
    const body = z.object({
      planId: z.string().min(8),
      txs: z.array(z.string().min(20)).min(1),
    }).parse(args)
    const plan = getPlan(body.planId)
    if (plan?.dest === 'balance') return toolText('Balance destination is not available on the partner API.', true)
    return toolText(await submitPlan(body.planId, body.txs, undefined, undefined, 'mcp'))
  }
  return null
}

async function dispatchMcp(message: unknown): Promise<{ status: number; body?: unknown }> {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return { status: 400, body: rpcError(null, -32600, 'Invalid request.') }
  }
  const row = message as { jsonrpc?: string; id?: unknown; method?: string; params?: unknown }
  if (row.jsonrpc !== '2.0' || !row.method) {
    return { status: 400, body: rpcError(row.id, -32600, 'Invalid request.') }
  }
  if (row.id === undefined) return { status: 202 }
  const params = row.params && typeof row.params === 'object' ? row.params as Record<string, unknown> : {}
  if (row.method === 'initialize') {
    const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-03-26'
    return {
      status: 200,
      body: {
        jsonrpc: '2.0',
        id: row.id,
        result: {
          protocolVersion: requested,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'grabster', version: '0.1.0' },
        },
      },
    }
  }
  if (row.method === 'ping') {
    return { status: 200, body: { jsonrpc: '2.0', id: row.id, result: {} } }
  }
  if (row.method === 'tools/list') {
    return { status: 200, body: { jsonrpc: '2.0', id: row.id, result: { tools } } }
  }
  if (row.method === 'tools/call') {
    const name = typeof params.name === 'string' ? params.name : ''
    try {
      const result = await runTool(name, params.arguments ?? {})
      if (!result) {
        return { status: 200, body: { jsonrpc: '2.0', id: row.id, result: toolText(`Unknown tool ${name}.`, true) } }
      }
      return { status: 200, body: { jsonrpc: '2.0', id: row.id, result } }
    } catch (err) {
      let message = err instanceof ZodError
        ? (err.issues[0]?.message || 'Invalid arguments.')
        : (err instanceof Error ? err.message : 'Request failed')
      // Tell the agent which transactions already went out, so it never re-sends or double-counts them.
      const sent = typeof err === 'object' && err && 'signatures' in err ? (err as { signatures?: unknown }).signatures : undefined
      if (Array.isArray(sent) && sent.length) message += ` Already sent: ${sent.join(', ')}`
      return { status: 200, body: { jsonrpc: '2.0', id: row.id, result: toolText(message, true) } }
    }
  }
  return { status: 200, body: rpcError(row.id, -32601, `Method not found: ${row.method}`) }
}

function send(req: Request, res: Response, status: number, body?: unknown) {
  if (status === 202 || body === undefined) {
    res.status(202).end()
    return
  }
  const accept = req.header('accept') || ''
  const sse = accept.includes('text/event-stream') && !accept.includes('application/json')
  if (sse) {
    res.status(status).type('text/event-stream').send(`event: message\ndata: ${JSON.stringify(body)}\n\n`)
    return
  }
  res.status(status).json(body)
}

/** Claude's connector box only has a URL, so the key may arrive as ?key= */
export function attachMcpKey(req: Request, _res: Response, next: () => void) {
  if (!req.header('authorization')) {
    const key = typeof req.query.key === 'string' ? req.query.key.trim() : ''
    if (key) req.headers.authorization = `Bearer ${key}`
  }
  next()
}

export function mcpRouterHandlers(req: Request, res: Response) {
  if (req.method === 'GET' || req.method === 'DELETE') {
    send(req, res, 405, rpcError(null, -32000, 'Method not allowed.'))
    return
  }
  dispatchMcp(req.body).then((out) => send(req, res, out.status, out.body)).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : 'Request failed'
    send(req, res, 200, { jsonrpc: '2.0', id: null, result: toolText(message, true) })
  })
}
