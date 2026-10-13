<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { classifyInput } from '@grabster/solana-core'
import { wallet } from '../lib/wallet'
import { replace } from '../lib/nav'
import { useStateStore, useUiStore, useWalletStore } from '../stores'
import DoneView from './DoneView.vue'
import EmptyView from './EmptyView.vue'
import ProgressView from './ProgressView.vue'
import ResultView from './ResultView.vue'
import ScanView from './ScanView.vue'

const route = useRoute()
const flow = useStateStore()
const ui = useUiStore()
const wallets = useWalletStore()
const shown = ref<'scan' | 'result' | 'empty' | 'progress' | 'done'>('scan')

watch(
  () => route.params.address,
  (raw) => {
    const address = typeof raw === 'string' ? raw : ''
    if (!address) return
    if (classifyInput(address).kind !== 'address') {
      flow.err = 'That doesn’t look like a Solana wallet address.'
      void replace({ name: 'cleanup' })
      return
    }
    const wasList = flow.mode === 'bulk'
    if (wasList && flow.screen === 'progress') return // a list is signing; don't disturb it
    flow.mode = 'single'
    // The estimate must belong to this address (a failed scan leaves the previous wallet's estimate behind).
    const same = flow.addr === address && flow.est?.addr === address
    if (same && flow.busy && !wasList) return
    if (same && !wasList && flow.screen !== 'hero') return
    if (same && flow.screen === 'hero') {
      // Back to a result after using the list tab: show it again without a rescan.
      const e = flow.est!
      flow.screen = e.empty || e.dust || e.nft || e.excess ? 'result' : 'empty'
      return
    }
    if (!flow.startScan(address)) void replace({ name: 'cleanup' })
  },
  { immediate: true },
)

watch(
  () => flow.screen,
  (screen) => {
    if (screen === 'scan' || screen === 'result' || screen === 'empty' || screen === 'progress' || screen === 'done') {
      shown.value = screen
    }
  },
  { immediate: true },
)

watch(
  () => wallet.publicKey,
  (next) => {
    if (next) return
    if (ui.claimOpen || wallets.pickerOpen) return
    ui.closeClaim()
  },
)
</script>

<template>
  <Transition name="page" mode="out-in">
    <ScanView v-if="shown === 'scan'" />
    <ResultView v-else-if="shown === 'result'" />
    <EmptyView v-else-if="shown === 'empty'" />
    <ProgressView v-else-if="shown === 'progress'" />
    <DoneView v-else />
  </Transition>
</template>
