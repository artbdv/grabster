import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { fulfillBulkConnect } from '../lib/bulk-run'
import {
  connectWallet,
  connectWalletConnect,
  disconnectWallet,
  onWalletAccountChange,
  type WalletName,
  wallet,
} from '../lib/wallet'

export type WalletAfter = 'scan' | 'login' | 'session' | 'claim' | 'claim-login' | 'bulk'

export const useWalletStore = defineStore('wallet', () => {
  const pickerOpen = ref(false)
  const after = ref<WalletAfter>('scan')
  const expectAddr = ref('')
  const signer = ref('')

  const connected = computed(() => Boolean(wallet.publicKey))
  const address = computed(() => wallet.publicKey)

  onWalletAccountChange((addr) => {
    void import('./state').then(({ useStateStore }) => {
      const flow = useStateStore()
      if (flow.bulkPhase !== 'need-connect') return
      if (addr && (addr === flow.bulkExpect || flow.bulkAccept.includes(addr))) {
        flow.bulkMismatch = ''
        fulfillBulkConnect()
      }
    })
  })

  function open(next: WalletAfter = 'scan', addr = '') {
    after.value = next
    expectAddr.value = addr
    pickerOpen.value = true
  }

  function close() {
    pickerOpen.value = false
  }

  function remember(addr: string) {
    signer.value = addr
  }

  function forget() {
    signer.value = ''
  }

  async function pick(name: WalletName) {
    if (name === 'WalletConnect') await connectWalletConnect()
    else await connectWallet(name)
    if (!wallet.publicKey) throw new Error('no pubkey')
    remember(wallet.publicKey)
    const { useStateStore } = await import('./state')
    const { useUiStore } = await import('./ui')
    const flow = useStateStore()
    const ui = useUiStore()
    if (after.value === 'claim') {
      close()
      // A different account: the result page keeps a standing explanation (connected vs required signer).
      if (flow.mode !== 'bulk' && flow.addr && wallet.publicKey !== flow.addr) return
      const { useAuthStore } = await import('./auth')
      try {
        if (!useAuthStore().address) await useAuthStore().loginWithConnectedWallet()
      } catch (e) {
        ui.showToast(e instanceof Error ? e.message : 'Could not sign in.')
        return
      }
      flow.openClaim()
      return
    }
    if (after.value === 'login' || after.value === 'claim-login') {
      const { useAuthStore } = await import('./auth')
      try {
        if (!useAuthStore().address) await useAuthStore().loginWithConnectedWallet()
      } catch (e) {
        ui.showToast(e instanceof Error ? e.message : 'Could not sign in.')
        return
      }
      if (after.value === 'claim-login') {
        close()
        flow.openClaim()
        return
      }
    }
    const onCheck = flow.screen === 'scan' || flow.screen === 'result' || flow.screen === 'empty'
    if (onCheck && wallet.publicKey === flow.addr) {
      close()
      return
    }
    if (after.value === 'session') {
      close()
      return
    }
    close()
    if (after.value === 'bulk') {
      const inList = flow.bulkAccept.includes(wallet.publicKey)
      if (expectAddr.value && wallet.publicKey !== expectAddr.value && !inList) {
        const { short } = await import('../lib/mock')
        flow.bulkMismatch = `You're on ${short(wallet.publicKey)}. Open the wallet app, switch to ${short(expectAddr.value)}, then connect again.`
        ui.showToast(flow.bulkMismatch)
        return
      }
      flow.bulkMismatch = ''
      if (flow.bulkPhase === 'need-connect') fulfillBulkConnect()
    }
  }

  async function drop() {
    await disconnectWallet()
    forget()
    const { useUiStore } = await import('./ui')
    useUiStore().closeClaim()
  }

  function reset() {
    close()
    forget()
  }

  return {
    pickerOpen, after, expectAddr, signer, connected, address,
    open, close, remember, forget, pick, drop, reset,
  }
})
