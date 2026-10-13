/** Mints we never burn or transfer. Closing empty accounts of these mints is fine. */
export const PROTECTED_MINTS = new Set<string>([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'So11111111111111111111111111111111111111112', // wSOL — closed, never burned
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // jitoSOL
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
  'bSo13r4TkiE4KumL71LsHTPpL2euCUQqT6ZVV8s6H', // bSOL
  '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4', // JupSOL
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP
])

export function isProtectedMint(mint: string): boolean {
  return PROTECTED_MINTS.has(mint)
}
