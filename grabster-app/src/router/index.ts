import { createRouter, createWebHistory } from 'vue-router'
import { routes } from './routes'

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, _from, savedPosition) {
    if (to.hash) {
      // Lazy pages render after navigation; wait for the anchor before scrolling.
      return new Promise((resolve) => {
        let tries = 0
        const look = () => {
          if (document.querySelector(to.hash) || tries++ > 20) resolve({ el: to.hash, top: 80, behavior: 'smooth' })
          else window.setTimeout(look, 50)
        }
        look()
      })
    }
    if (savedPosition) return savedPosition
    return { top: 0, left: 0 }
  },
})
