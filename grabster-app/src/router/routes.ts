import type { RouteLocation, RouteRecordRaw } from 'vue-router'
import { SHOW_REFERRALS } from '../lib/features'

/** Old public URLs keep working: same query (ref params included) and hash, new place. */
function moved(path: string, extraQuery: Record<string, string> = {}) {
  return (to: RouteLocation) => ({ path, query: { ...to.query, ...extraQuery }, hash: to.hash })
}

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('../views/HomeView.vue'),
  },
  {
    path: '/cleanup',
    name: 'cleanup',
    component: () => import('../views/CleanupView.vue'),
  },
  {
    path: '/check/:address',
    name: 'check',
    component: () => import('../views/CheckView.vue'),
  },
  {
    path: '/profile',
    component: () => import('../views/profile/ProfileView.vue'),
    children: [
      { path: '', name: 'profile', component: () => import('../views/profile/ProfileOverview.vue') },
      { path: 'balance', name: 'profile-balance', component: () => import('../views/profile/ProfileBalance.vue') },
      { path: 'activity', name: 'profile-activity', component: () => import('../views/profile/ProfileActivity.vue') },
      { path: 'api-key', name: 'profile-key', component: () => import('../views/profile/ProfileApiKey.vue') },
      SHOW_REFERRALS
        ? { path: 'referrals', name: 'profile-referrals', component: () => import('../views/profile/ProfileReferrals.vue') }
        : { path: 'referrals', name: 'profile-referrals', redirect: '/profile' },
    ],
  },
  {
    path: '/r/:code',
    name: 'ref',
    component: () => import('../views/RefLanding.vue'),
  },
  {
    path: '/local',
    name: 'local',
    component: () => import('../views/LocalView.vue'),
  },
  {
    path: '/api',
    name: 'api',
    component: () => import('../views/ApiView.vue'),
  },
  {
    path: '/mcp',
    name: 'mcp',
    component: () => import('../views/McpView.vue'),
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('../views/DashboardView.vue'),
  },
  // Old URLs → new sections.
  { path: '/bulk', redirect: moved('/cleanup', { mode: 'list' }) },
  { path: '/balance', redirect: moved('/profile/balance') },
  { path: '/referrals', redirect: moved('/profile/referrals') },
  { path: '/developers', redirect: moved('/api') },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]
