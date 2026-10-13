import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const apiUrl = (process.env.GRABSTER_API_URL || 'http://localhost:8787').replace(/\/$/, '')
const apiKey = (process.env.GRABSTER_API_KEY || '').trim()

if (!apiKey) {
  console.error('Set GRABSTER_API_KEY to a Grabster partner key.')
  process.exit(1)
}

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = await res.json().catch(() => ({})) as { error?: string }
  if (!res.ok) throw new Error(payload.error || res.statusText || 'Request failed')
  return payload
}

function text(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

function failure(err: unknown) {
  const message = err instanceof Error ? err.message : 'Request failed'
  return { content: [{ type: 'text' as const, text: message }], isError: true as const }
}

const account = z.string().min(32).max(44)
const server = new McpServer({ name: 'grabster', version: '0.1.0' })

server.tool(
  'scan_address',
  'Scan one Solana wallet for reclaimable rent. Never pass a private key or seed.',
  { address: account },
  async ({ address }) => {
    try {
      return text(await call('GET', `/v1/partner/scan/${encodeURIComponent(address)}`))
    } catch (err) {
      return failure(err)
    }
  },
)

server.tool(
  'scan_batch',
  'Scan up to 25 Solana wallets. Never pass private keys or seeds.',
  { addresses: z.array(z.string().min(1).max(128)).min(1).max(25) },
  async ({ addresses }) => {
    try {
      return text(await call('POST', '/v1/partner/scan', { addresses }))
    } catch (err) {
      return failure(err)
    }
  },
)

server.tool(
  'plan_reclaim',
  'Build unsigned reclaim transactions. The caller signs them. Fee recipient is fixed by Grabster. dest is same or other, never balance. Do not pass a private key.',
  {
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
  },
  async (input) => {
    try {
      return text(await call('POST', '/v1/partner/plan', input))
    } catch (err) {
      return failure(err)
    }
  },
)

server.tool(
  'submit_signed',
  'Submit owner-signed transactions for a plan Grabster already built. Pass the signed transaction bytes, never a private key.',
  {
    planId: z.string().min(8),
    txs: z.array(z.string().min(20)).min(1),
  },
  async ({ planId, txs }) => {
    try {
      return text(await call('POST', '/v1/partner/submit', { planId, txs }))
    } catch (err) {
      return failure(err)
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
