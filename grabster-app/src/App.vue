<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import AppFooter from './components/AppFooter.vue'
import AppHeader from './components/AppHeader.vue'
import ClaimDialog from './components/ClaimDialog.vue'
import WalletPicker from './components/WalletPicker.vue'
import { startBulkSign } from './lib/bulk-sign'
import { initAppKit } from './lib/wallet'
import { useAuthStore, useBalanceStore, useStateStore, useUiStore, useWalletStore } from './stores'

const route = useRoute()
/** Nested routes (profile tabs) share their parent page, so switching tabs doesn't remount it. */
const pageKey = computed(() => (route.matched.length > 1 ? route.matched[0].path : route.path))
const flow = useStateStore()
const ui = useUiStore()
const wallets = useWalletStore()
const auth = useAuthStore()

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!flow.shouldWarnLeave) return
  e.preventDefault()
  e.returnValue = ''
}

onMounted(() => {
  void flow.loadConfig()
  void auth.boot()
  useBalanceStore().start()
  initAppKit()
  flow.restoreRoute()
  if (flow.mode === 'bulk' && flow.screen === 'progress') {
    // Cancelling a resumed run rejects with 'stopped'; that is the expected end, not an error.
    startBulkSign({ resume: true }).catch((e: unknown) => {
      if (!(e instanceof Error && e.message === 'stopped')) ui.showToast(e instanceof Error ? e.message : 'The cleanup stopped.')
    })
  }
  window.addEventListener('beforeunload', onBeforeUnload)
})

onUnmounted(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
})
</script>

<template>
  <a class="skip" href="#main">Skip to content</a>
  <div class="wrap">
    <AppHeader />
    <main id="main" tabindex="-1">
      <router-view v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" :key="pageKey" />
        </Transition>
      </router-view>
    </main>
    <AppFooter />
  </div>

  <Transition name="modal">
    <ClaimDialog v-if="ui.claimOpen" />
  </Transition>
  <Transition name="modal">
    <WalletPicker v-if="wallets.pickerOpen" />
  </Transition>
  <Transition name="modal">
    <div v-if="ui.leaveOpen" class="modal" role="dialog" aria-modal="true" aria-labelledby="leaveTitle" @click.self="ui.stay">
      <div class="card leave-card">
        <h2 id="leaveTitle">Leave this page?</h2>
        <p class="muted">Accounts are still being closed. If you leave now, you’ll need to connect again to finish the remaining wallets.</p>
        <div class="leave-actions">
          <button class="btn btn-ghost" type="button" @click="ui.stay">Stay</button>
          <button class="btn" type="button" @click="ui.confirmLeave">Leave</button>
        </div>
      </div>
    </div>
  </Transition>
  <Transition name="toast">
    <div v-if="ui.toast" class="toast" role="status">{{ ui.toast }}</div>
  </Transition>
</template>

<style scoped lang="scss">
.wrap {
  width: 100%;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

main {
  flex: 1 1 auto;
  width: 100%;
  max-width: var(--max);
  margin: 0 auto;
  padding: 0 var(--gutter) 64px;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.leave-card { max-width: 480px; }

/* Same as the shared .modal-actions: a bar across the bottom of the card, cells split by a rule. */
.leave-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  margin: 28px calc(-1 * var(--pad)) calc(-1 * var(--pad));
  border-top: 1px solid var(--ink);

  .btn {
    min-height: 60px;
    border: 0;
    padding-left: var(--pad);
    font-size: 17px;
  }

  .btn + .btn { border-left: 1px solid var(--ink); }
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  min-height: 52px;
  background: var(--ink);
  color: var(--bg);
  padding: 12px 20px;
  border: 1px solid var(--ink);
  border-radius: 0;
  font-weight: 500;
  font-size: 15px;
  z-index: 50;
  max-width: calc(100vw - 2 * var(--gutter));
}

.skip {
  position: absolute;
  left: 16px;
  top: -60px;
  z-index: 60;
  background: var(--ink);
  color: var(--bg);
  padding: 10px 14px;
  text-decoration: none;

  &:focus { top: 12px; }
}

main:focus { outline: none; }

.toast-enter-active,
.toast-leave-active {
  transition: 0.25s;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(120%);
}
</style>
