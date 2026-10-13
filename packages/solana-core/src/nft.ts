import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js'
import { PROGRAMS } from './programs'

export const BURN_NFT_DISCRIMINATOR = 29
export const BURN_V1_DISCRIMINATOR = 41
/** Programmable NFT — needs Burn V1 + token record. */
export const TOKEN_STANDARD_PNFT = 4
export const TOKEN_STANDARD_PNFT_EDITION = 5
export const SYSVAR_INSTRUCTIONS = 'Sysvar1nstructions1111111111111111111111111'
export const AUTH_RULES = 'auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg'

const META = new PublicKey(PROGRAMS.METADATA)
const NONE = { pubkey: META, isSigner: false, isWritable: false }

export function metadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), META.toBuffer(), mint.toBuffer()],
    META,
  )[0]
}

export function editionPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), META.toBuffer(), mint.toBuffer(), Buffer.from('edition')],
    META,
  )[0]
}

export function tokenRecordPda(mint: PublicKey, token: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), META.toBuffer(), mint.toBuffer(), Buffer.from('token_record'), token.toBuffer()],
    META,
  )[0]
}

export function isPnftStandard(standard: number | null): boolean {
  return standard === TOKEN_STANDARD_PNFT
}

export function burnNftInstruction(input: {
  owner: PublicKey
  mint: PublicKey
  token: PublicKey
  metadata: PublicKey
  edition: PublicKey
  tokenProgram: PublicKey
  collectionMetadata?: PublicKey
}): TransactionInstruction {
  const keys = [
    { pubkey: input.metadata, isSigner: false, isWritable: true },
    { pubkey: input.owner, isSigner: true, isWritable: true },
    { pubkey: input.mint, isSigner: false, isWritable: true },
    { pubkey: input.token, isSigner: false, isWritable: true },
    { pubkey: input.edition, isSigner: false, isWritable: true },
    { pubkey: input.tokenProgram, isSigner: false, isWritable: false },
  ]
  if (input.collectionMetadata) {
    keys.push({ pubkey: input.collectionMetadata, isSigner: false, isWritable: true })
  }
  return new TransactionInstruction({
    programId: META,
    keys,
    data: Buffer.from([BURN_NFT_DISCRIMINATOR]),
  })
}

export function burnV1Instruction(input: {
  owner: PublicKey
  mint: PublicKey
  token: PublicKey
  metadata: PublicKey
  edition: PublicKey
  tokenProgram: PublicKey
  tokenRecord?: PublicKey
  collectionMetadata?: PublicKey
  ruleSet?: PublicKey
}): TransactionInstruction {
  const keys = [
    { pubkey: input.owner, isSigner: true, isWritable: true },
    input.collectionMetadata
      ? { pubkey: input.collectionMetadata, isSigner: false, isWritable: true }
      : NONE,
    { pubkey: input.metadata, isSigner: false, isWritable: true },
    { pubkey: input.edition, isSigner: false, isWritable: true },
    { pubkey: input.mint, isSigner: false, isWritable: true },
    { pubkey: input.token, isSigner: false, isWritable: true },
    NONE,
    NONE,
    NONE,
    NONE,
    input.tokenRecord
      ? { pubkey: input.tokenRecord, isSigner: false, isWritable: true }
      : NONE,
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: new PublicKey(SYSVAR_INSTRUCTIONS), isSigner: false, isWritable: false },
    { pubkey: input.tokenProgram, isSigner: false, isWritable: false },
  ]
  if (input.ruleSet) {
    keys.push(
      { pubkey: new PublicKey(AUTH_RULES), isSigner: false, isWritable: false },
      { pubkey: input.ruleSet, isSigner: false, isWritable: false },
    )
  }
  const data = Buffer.alloc(10)
  data[0] = BURN_V1_DISCRIMINATOR
  data[1] = 0
  data.writeBigUInt64LE(1n, 2)
  return new TransactionInstruction({ programId: META, keys, data })
}

export function parseNftMetadata(data: Uint8Array): {
  collection: string
  collectionVerified: boolean
  tokenStandard: number | null
  ruleSet: string
} {
  const empty = { collection: '', collectionVerified: false, tokenStandard: null, ruleSet: '' }
  try {
    const buf = Buffer.from(data)
    let o = 1 + 32 + 32
    o = skipString(buf, o)
    o = skipString(buf, o)
    o = skipString(buf, o)
    o += 2
    const creators = readOption(buf, o)
    o = creators.o
    if (creators.some) {
      const n = buf.readUInt32LE(o)
      o += 4 + n * 34
    }
    o += 2
    const editionNonce = readOption(buf, o)
    o = editionNonce.o + (editionNonce.some ? 1 : 0)
    const ts = readOption(buf, o)
    o = ts.o
    let tokenStandard: number | null = null
    if (ts.some) {
      tokenStandard = buf[o] ?? null
      o += 1
    }
    const col = readOption(buf, o)
    o = col.o
    let collection = ''
    let collectionVerified = false
    if (col.some) {
      if (o + 33 > buf.length) return { collection: '', collectionVerified: false, tokenStandard, ruleSet: '' }
      collectionVerified = buf[o] === 1
      collection = new PublicKey(buf.subarray(o + 1, o + 33)).toBase58()
      o += 33
    }
    const uses = readOption(buf, o)
    o = uses.o
    if (uses.some) o += 17
    const details = readOption(buf, o)
    o = details.o
    if (details.some) o += 9
    const prog = readOption(buf, o)
    o = prog.o
    let ruleSet = ''
    if (prog.some && o < buf.length) {
      o += 1
      const rs = readOption(buf, o)
      o = rs.o
      if (rs.some && o + 32 <= buf.length) ruleSet = new PublicKey(buf.subarray(o, o + 32)).toBase58()
    }
    return { collection, collectionVerified, tokenStandard, ruleSet }
  } catch {
    return empty
  }
}

function skipString(buf: Buffer, o: number): number {
  const n = buf.readUInt32LE(o)
  if (n > 1024 || o + 4 + n > buf.length) throw new Error('bad string')
  return o + 4 + n
}

function readOption(buf: Buffer, o: number): { some: boolean; o: number } {
  if (o >= buf.length) throw new Error('short')
  return { some: buf[o] === 1, o: o + 1 }
}
