import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useUiStore = defineStore('ui', () => {
  const toast = ref('')
  const claimOpen = ref(false)
  const keyOpen = ref(false)
  const leaveOpen = ref(false)
  let leaveNext: (() => void) | null = null

  function askLeave(next: () => void) {
    leaveNext = next
    leaveOpen.value = true
  }

  function confirmLeave() {
    leaveOpen.value = false
    const next = leaveNext
    leaveNext = null
    next?.()
  }

  function stay() {
    leaveOpen.value = false
    leaveNext = null
  }

  function showToast(msg: string, ms = 1600) {
    toast.value = msg
    window.setTimeout(() => { if (toast.value === msg) toast.value = '' }, ms)
  }

  function openClaim() {
    claimOpen.value = true
  }

  function closeClaim() {
    claimOpen.value = false
    keyOpen.value = false
  }

  function reset() {
    toast.value = ''
    closeClaim()
    stay()
  }

  return {
    toast, claimOpen, keyOpen, leaveOpen,
    showToast, openClaim, closeClaim, askLeave, confirmLeave, stay, reset,
  }
})
