import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

const envDir = fileURLToPath(new URL('..', import.meta.url))

/** Public pages listed in sitemap.xml. Keep in sync with src/router/routes.ts. */
const PUBLIC_PATHS = ['/', '/cleanup', '/api', '/mcp', '/local']

/**
 * Fills __SITE_URL__ in index.html (canonical, og:url, og:image) and emits
 * robots.txt + sitemap.xml for the configured public origin. Without
 * VITE_SITE_URL the tags fall back to relative URLs and no sitemap is written.
 */
function siteMeta(siteUrl: string): Plugin {
  const origin = siteUrl.replace(/\/$/, '')
  return {
    name: 'grabster-site-meta',
    transformIndexHtml(html) {
      return html.replaceAll('__SITE_URL__', origin)
    },
    generateBundle() {
      const robots = origin
        ? `User-agent: *\nAllow: /\nDisallow: /profile\n\nSitemap: ${origin}/sitemap.xml\n`
        : 'User-agent: *\nAllow: /\nDisallow: /profile\n'
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots })
      if (!origin) return
      const urls = PUBLIC_PATHS.map((p) => `  <url><loc>${origin}${p === '/' ? '/' : p}</loc></url>`).join('\n')
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '')
  return {
    envDir,
    plugins: [vue(), nodePolyfills(), siteMeta(env.VITE_SITE_URL || '')],
  }
})
