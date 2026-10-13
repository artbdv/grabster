<script setup lang="ts">
import { useRouter } from 'vue-router'
import { apiOrigin } from '../lib/api'
import { useStateStore, useUiStore } from '../stores'

const router = useRouter()
const flow = useStateStore()
const ui = useUiStore()

const COLS = [
  { title: 'Product', links: [{ href: '/cleanup', label: 'Cleanup' }, { href: '/cleanup?mode=list', label: 'Batch cleanup' }, { href: '/#faq-how', label: 'How it works' }, { href: '/dashboard', label: 'Dashboard' }] },
  { title: 'Build', links: [{ href: '/api', label: 'API' }, { href: '/mcp', label: 'MCP' }, { href: '/local', label: 'Local file' }] },
  { title: 'Account', links: [{ href: '/profile', label: 'Profile' }, { href: '/profile/balance', label: 'Grabster balance' }] },
]

function go(path: string) {
  const next = () => { void router.push(path) }
  if (flow.shouldWarnLeave) ui.askLeave(next)
  else next()
}
</script>

<template>
  <footer class="foot">
    <div class="cols">
      <div class="about">
        <p class="claim">Recover SOL from unused token accounts — from one wallet or a whole list.</p>
        <!-- Project contacts, apart from the page links. -->
        <a class="x-link" href="https://x.com/grabsterxyz" target="_blank" rel="noopener noreferrer" aria-label="Grabster on X">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          <span>@grabsterxyz</span>
        </a>
      </div>
      <nav v-for="c in COLS" :key="c.title" class="col" :aria-label="c.title">
        <p class="col-title">{{ c.title }}</p>
        <a v-for="l in c.links" :key="l.href" :href="l.href" @click.prevent="go(l.href)">{{ l.label }}</a>
        <a v-if="c.title === 'Build'" :href="`${apiOrigin}/v1/partner/openapi.yaml`" target="_blank" rel="noopener">OpenAPI spec</a>
      </nav>
    </div>
  </footer>
</template>

<style scoped lang="scss">
.foot {
  margin-top: auto;
  border-top: 1px solid var(--line-2);
}

.cols {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr;

  > * {
    padding: 24px var(--gutter) 32px;
    border-right: 1px solid var(--line-2);
  }

  > :last-child { border-right: 0; }

  @media (max-width: 760px) {
    grid-template-columns: 1fr 1fr;

    .about { grid-column: 1 / -1; border-right: 0; border-bottom: 1px solid var(--line-2); }
    > :nth-child(3) { border-right: 0; }
    > :last-child { grid-column: 1 / -1; border-top: 1px solid var(--line-2); }
  }
}

.about {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 20px;
}

.x-link {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 14px;
  border: 1px solid var(--line-3);
  color: var(--ink);
  text-decoration: none;
  font-size: 15px;
  font-weight: 600;
  transition: background 0.15s, color 0.15s, border-color 0.15s;

  &:hover {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--bg);
  }
}

.claim {
  font-size: 22px;
  line-height: 1.15;
  letter-spacing: -0.02em;
  max-width: 24ch;
}

.col {
  display: grid;
  align-content: start;
  gap: 8px;

  .col-title { font-size: 14px; color: var(--muted); margin-bottom: 6px; }

  a {
    color: var(--ink);
    text-decoration: none;
    font-size: 18px;
    width: fit-content;

    &:hover { color: var(--accent-text); }
  }
}
</style>
