import type { RouteLocationRaw, Router } from 'vue-router'

/** Cleanup in Wallet list mode (old /bulk). */
export const LIST_ROUTE: RouteLocationRaw = { name: 'cleanup', query: { mode: 'list' } }

let router: Router | null = null

export function setRouter(r: Router) {
  router = r
}

export function go(to: RouteLocationRaw) {
  return router?.push(to)
}

export function replace(to: RouteLocationRaw) {
  return router?.replace(to)
}
