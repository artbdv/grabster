import { Keypair } from '@solana/web3.js'
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { derivePath } from 'ed25519-hd-key'
import { classifyInput, type Classified } from '@grabster/solana-core'

export interface BulkWallet {
  addr: string
  kind: 'address' | 'key' | 'seed'
  secret?: Uint8Array
}

export interface DeriveRange {
  from: number
  to: number
}

const WORD_COUNTS = new Set([12, 15, 18, 21, 24])
const MAX_INDEX = 50

/** Phantom / Solflare, then Ledger-style (no change index). Same address is dropped. */
function pathsFor(index: number): string[] {
  return [`m/44'/501'/${index}'/0'`, `m/44'/501'/${index}'`]
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function clampRange(from: number, to: number): DeriveRange {
  const a = Math.min(MAX_INDEX, Math.max(0, Math.floor(from) || 0))
  const b = Math.min(MAX_INDEX, Math.max(0, Math.floor(to) || 0))
  return a <= b ? { from: a, to: b } : { from: b, to: a }
}

export function isMnemonic(raw: string): boolean {
  const words = raw.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return WORD_COUNTS.has(words.length) && validateMnemonic(words.join(' '), wordlist)
}

function normalizeMnemonic(raw: string): string {
  return raw.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ')
}

export function expandMnemonic(mnemonic: string, range: DeriveRange): BulkWallet[] {
  const phrase = normalizeMnemonic(mnemonic)
  if (!validateMnemonic(phrase, wordlist)) return []
  const seed = mnemonicToSeedSync(phrase)
  const hex = toHex(seed)
  const out: BulkWallet[] = []
  const seen = new Set<string>()
  for (let i = range.from; i <= range.to; i++) {
    for (const path of pathsFor(i)) {
      try {
        const { key } = derivePath(path, hex)
        const kp = Keypair.fromSeed(key)
        const addr = kp.publicKey.toBase58()
        if (seen.has(addr)) continue
        seen.add(addr)
        out.push({ addr, kind: 'seed', secret: kp.secretKey })
      } catch {
        /* skip a bad path */
      }
    }
  }
  return out
}

function keyFromRaw(raw: string): BulkWallet | null {
  const c = classifyInput(raw)
  if (c.kind === 'key') return { addr: c.addr, kind: 'key', secret: c.secret }
  if (c.kind === 'address') return { addr: c.addr, kind: 'address' }
  return null
}

function isHeader(parts: string[]): boolean {
  const joined = parts.join(' ').toLowerCase()
  return /mnemonic|seed phrase|private key|^key\b/.test(joined) && /address|wallet|pubkey|mnemonic/.test(joined)
}

function walletsFromLine(line: string, range: DeriveRange): BulkWallet[] {
  if (line.includes('|')) {
    const parts = line.split('|').map((s) => s.trim())
    if (isHeader(parts)) return []
    const [key = '', mnemonic = '', address = ''] = parts
    const out: BulkWallet[] = []
    if (key) {
      const got = keyFromRaw(key)
      if (got) out.push(got)
    }
    if (mnemonic && isMnemonic(mnemonic)) out.push(...expandMnemonic(mnemonic, range))
    if (address) {
      const got = keyFromRaw(address)
      if (got) out.push(got)
    }
    return out
  }
  if (isMnemonic(line)) return expandMnemonic(line, range)
  const got = keyFromRaw(line)
  return got ? [got] : []
}

export function parseBulkText(text: string, range: DeriveRange): BulkWallet[] {
  const clamped = clampRange(range.from, range.to)
  const unique: BulkWallet[] = []
  for (const line of text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
    for (const wallet of walletsFromLine(line, clamped)) {
      const i = unique.findIndex((u) => u.addr === wallet.addr)
      if (i < 0) unique.push(wallet)
      else if (!unique[i].secret && wallet.secret) unique[i] = wallet
    }
  }
  return unique
}

export function classifyLoose(raw: string): Classified | { kind: 'seed'; mnemonic: string; raw: string } {
  const s = (raw || '').trim()
  if (isMnemonic(s)) return { kind: 'seed', mnemonic: normalizeMnemonic(s), raw: s }
  return classifyInput(s)
}

/** Show the account-index range only when a seed is actually in the paste. */
export function textHasSeed(text: string): boolean {
  for (const line of text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
    if (line.includes('|')) {
      const mnemonic = line.split('|')[1]?.trim() || ''
      if (mnemonic.split(/\s+/).filter(Boolean).length >= 12) return true
    } else if (line.split(/\s+/).filter(Boolean).length >= 12) {
      return true
    }
  }
  return false
}
