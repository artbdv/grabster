import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { loadBook, onBook } from '../lib/siws'
import { useAuthStore } from './auth'
import { useStateStore } from './state'

/** Background refresh while signed in: credits settle on the server's own timer. */
const POLL_MS = 60_000

/**
 * The signed-in wallet's Grabster balance for the header. Same source as Profile → Balance
 * (GET /v1/balance); any book loaded elsewhere updates it too.
 */
export const useBalanceStore = defineStore('balance', () => {
  const availableSol = ref<number | null>(null)
  const pendingSol = ref(0)
  const loading = ref(false)
  const err = ref('')
  let owner = ''
  let gen = 0
  let timer: number | undefined

  onBook((book) => {
    if (book.address && owner && book.address !== owner) return
    availableSol.value = book.availableSol
    pendingSol.value = book.pendingSol
    err.value = ''
  })

  async function refresh() {
    const auth = useAuthStore()
    if (!auth.address) return
    const mine = ++gen
    loading.value = true
    err.value = ''
    try {
      await loadBook() // the onBook listener stores the figures
    } catch (e) {
      if (mine === gen) err.value = e instanceof Error && e.message ? e.message : 'Could not load the balance.'
    } finally {
      if (mine === gen) loading.value = false
    }
  }

  function clear() {
    gen++
    availableSol.value = null
    pendingSol.value = 0
    loading.value = false
    err.value = ''
  }

  function schedule() {
    window.clearInterval(timer)
    timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !loading.value) void refresh()
    }, POLL_MS)
  }

  function start() {
    const auth = useAuthStore()
    const flow = useStateStore()
    watch(() => auth.address, (addr) => {
      owner = addr
      clear()
      window.clearInterval(timer)
      if (!addr) return
      void refresh()
      schedule()
    }, { immediate: true })
    // A finished cleanup may have credited the balance.
    watch(() => flow.screen, (screen) => {
      if (screen === 'done' && auth.address) void refresh()
    })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && auth.address && !loading.value) void refresh()
    })
  }

  return { availableSol, pendingSol, loading, err, refresh, start }
})
