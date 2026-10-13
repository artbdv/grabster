import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('/app/.env', 'utf8')
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const cut = line.indexOf('=')
      const key = line.slice(0, cut).trim()
      const value = line.slice(cut + 1).trim().replace(/^['"]|['"]$/g, '')
      return [key, value]
    }),
)

const api = env.VITE_API_URL || ''
const treasury = env.TREASURY_ADDRESS || ''

if (!treasury) {
  console.error('TREASURY_ADDRESS is empty. The downloadable file needs it.')
  process.exit(1)
}

if (!api || /localhost|127\.0\.0\.1/.test(api)) {
  console.error('VITE_API_URL must be the public API address, reachable from a browser.')
  process.exit(1)
}

const site = env.VITE_SITE_URL || ''
if (!/^https:\/\//.test(site)) {
  // Not fatal: the site still works, but canonical/og:image stay relative and no sitemap is written.
  console.warn('VITE_SITE_URL is not set to an https:// origin. Set it to the public site address (see docs/release-domain.md).')
}
