import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { fetchAuthMe, onAuthDead } from '../lib/api'
import { accessToken, refreshToken, sessionAddress, setSessionAddress } from '../lib/auth-cookies'
import { loginWithWallet, logoutSession } from '../lib/siws'
import { disconnectWallet, forgetLastWallet, wallet } from '../lib/wallet'

export const useAuthStore = defineStore('auth', () => {
  const address = ref('')
  const ready = ref(false)
  const busy = ref(false)

  const loggedIn = computed(() => Boolean(address.value))

  async function boot() {
    onAuthDead(() => {
      address.value = ''
      setSessionAddress('')
    })
    const cached = sessionAddress()
    if (cached) address.value = cached
    if (!accessToken() && !refreshToken()) {
      address.value = ''
      setSessionAddress('')
      ready.value = true
      return
    }
    try {
      const me = await fetchAuthMe()
      address.value = me.address
      setSessionAddress(me.address)
    } catch {
      address.value = ''
      setSessionAddress('')
    } finally {
      ready.value = true
    }
  }

  async function loginWithConnectedWallet() {
    if (!wallet.publicKey) throw new Error('Connect a wallet first.')
    busy.value = true
    try {
      address.value = await loginWithWallet(wallet.publicKey)
      setSessionAddress(address.value)
    } finally {
      busy.value = false
    }
  }

  async function login() {
    if (address.value) return
    const { useWalletStore } = await import('./wallet')
    const { useUiStore } = await import('./ui')
    if (!wallet.publicKey) {
      useWalletStore().open('login')
      return
    }
    try {
      await loginWithConnectedWallet()
    } catch (e) {
      useUiStore().showToast(e instanceof Error ? e.message : 'Could not sign in.')
    }
  }

  async function logout() {
    await logoutSession()
    address.value = ''
    forgetLastWallet()
    await disconnectWallet()
    const { useWalletStore } = await import('./wallet')
    useWalletStore().forget()
  }

  return {
    address, ready, busy, loggedIn,
    boot, login, loginWithConnectedWallet, logout,
  }
})
