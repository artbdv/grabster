import { classifyInput } from '@grabster/solana-core'
import { classifyLoose } from './bulk-input'

export interface ListCheck {
  /** Unique valid addresses in input order. */
  valid: { addr: string; line: number }[]
  /** Addresses that appeared more than once (first line kept). */
  duplicates: { addr: string; lines: number[] }[]
  /** Lines that held no usable address. */
  invalid: { line: number; text: string; reason: string }[]
  /** Lines that looked like a private key or seed phrase. Never kept here. */
  secrets: number[]
}

const HEADER = /\b(address|wallet|pubkey|public ?key|owner)\b/i

/** Long base58 runs and byte arrays may be (broken) keys: never echo them. */
const SECRETISH = /[1-9A-HJ-NP-Za-km-z]{60,}|\[\s*\d{1,3}\s*(,\s*\d{1,3}\s*){15,}|^\s*([a-z]+\s+){10,}[a-z]+\s*$/i

function preview(text: string): string {
  const t = text.trim()
  if (SECRETISH.test(t)) return '(hidden — looks like key material)'
  return t.length > 48 ? `${t.slice(0, 22)}…${t.slice(-12)}` : t
}

/**
 * Parse the public-address box: one address per line, or a CSV/TSV where any
 * column holds the address. Private keys and seed phrases are detected and
 * reported, but never returned — they belong in the separate key import.
 */
export function checkAddressList(text: string): ListCheck {
  const out: ListCheck = { valid: [], duplicates: [], invalid: [], secrets: [] }
  const firstLine = new Map<string, number>()
  const dupes = new Map<string, number[]>()

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    // A whole-line key (incl. a JSON byte array, which has commas) or seed phrase.
    const whole = classifyLoose(trimmed)
    if (whole.kind === 'key' || whole.kind === 'seed') {
      out.secrets.push(line)
      return
    }
    let found = ''
    let sawSecret = false
    for (const field of trimmed.split(/[,;|\t]+/)) {
      const f = field.trim().replace(/^["']|["']$/g, '')
      if (!f) continue
      if (classifyLoose(f).kind === 'seed') { sawSecret = true; continue }
      for (const tok of f.split(/\s+/)) {
        const c = classifyInput(tok)
        if (c.kind === 'address' && !found) found = c.addr
        else if (c.kind === 'key') sawSecret = true
      }
    }
    if (sawSecret) out.secrets.push(line)
    if (!found) {
      if (!sawSecret && !(line === 1 && HEADER.test(trimmed))) {
        out.invalid.push({ line, text: preview(trimmed), reason: 'Not a Solana address' })
      }
      return
    }
    const seen = firstLine.get(found)
    if (seen !== undefined) {
      const lines = dupes.get(found) || [seen]
      lines.push(line)
      dupes.set(found, lines)
      return
    }
    firstLine.set(found, line)
    out.valid.push({ addr: found, line })
  })

  out.duplicates = [...dupes].map(([addr, lines]) => ({ addr, lines }))
  return out
}
