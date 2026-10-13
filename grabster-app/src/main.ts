import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { setRouter } from './lib/nav'
import { router } from './router'
import './styles/app.scss'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
setRouter(router)

router.beforeEach((to) => {
  if (to.name !== 'check') return true
  const address = typeof to.params.address === 'string' ? to.params.address : ''
  if (!address) return { name: 'home' }
  return true
})

/* Per-page title and canonical URL: every route shares index.html, which only knows the home page. */
const TITLES: Record<string, string> = {
  home: 'Grabster — get your SOL back',
  cleanup: 'Cleanup — Grabster',
  check: 'Cleanup — Grabster',
  api: 'API — Grabster',
  mcp: 'MCP — Grabster',
  local: 'Local file — Grabster',
}

router.afterEach((to) => {
  const name = String(to.name || '')
  document.title = TITLES[name] || (to.path.startsWith('/profile') ? 'Profile — Grabster' : TITLES.home)
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  const ogUrl = document.querySelector<HTMLMetaElement>('meta[property="og:url"]')
  // Built origin (VITE_SITE_URL) when the tag holds an absolute URL, else the current one.
  const href = canonical?.getAttribute('href') || ''
  const base = /^https?:\/\/[^/]/.test(href) ? new URL(href).origin : location.origin
  const path = name === 'check' ? '/cleanup' : to.path
  canonical?.setAttribute('href', `${base}${path}`)
  ogUrl?.setAttribute('content', `${base}${path}`)
})

app.use(router).mount('#app')
