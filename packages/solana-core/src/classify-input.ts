import { Keypair, PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'

export type Classified =
  | { kind: 'none' }
  | { kind: 'bad' }
  | { kind: 'address'; addr: string; raw: string }
  | { kind: 'key'; addr: string; raw: string; secret: Uint8Array }

const B58 = /^[1-9A-HJ-NP-Za-km-z]+$/

function keypairFromBytes(bytes: Uint8Array): Keypair | null {
  try {
    if (bytes.length === 64) return Keypair.fromSecretKey(bytes)
    if (bytes.length === 32) return Keypair.fromSeed(bytes)
  } catch {
    return null
  }
  return null
}

export function classifyInput(input: string): Classified {
  const s = (input || '').trim()
  if (!s) return { kind: 'none' }

  if (/^\[\s*-?\d+(\s*,\s*-?\d+){31,63}\s*\]$/.test(s)) {
    try {
      const arr = JSON.parse(s) as number[]
      const bytes = Uint8Array.from(arr)
      const kp = keypairFromBytes(bytes)
      if (kp) return { kind: 'key', addr: kp.publicKey.toBase58(), raw: s, secret: kp.secretKey }
    } catch {
      return { kind: 'bad' }
    }
    return { kind: 'bad' }
  }

  if (!B58.test(s)) return { kind: 'bad' }

  if (s.length >= 32 && s.length <= 44) {
    try {
      const pk = new PublicKey(s)
      if (pk.toBase58() === s || pk.toBytes().length === 32) {
        return { kind: 'address', addr: pk.toBase58(), raw: s }
      }
    } catch {
      return { kind: 'bad' }
    }
  }

  if (s.length >= 64 && s.length <= 90) {
    try {
      const bytes = bs58.decode(s)
      const kp = keypairFromBytes(bytes)
      if (kp) return { kind: 'key', addr: kp.publicKey.toBase58(), raw: s, secret: kp.secretKey }
    } catch {
      return { kind: 'bad' }
    }
  }

  return { kind: 'bad' }
}

export function secretFromRaw(raw: string): Uint8Array | null {
  const c = classifyInput(raw)
  return c.kind === 'key' ? c.secret : null
}
