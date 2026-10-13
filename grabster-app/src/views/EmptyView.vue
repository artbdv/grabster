<script setup lang="ts">
import { useRouter } from 'vue-router'
import { short } from '../lib/mock'
import { useStateStore } from '../stores'

const flow = useStateStore()
const router = useRouter()

function another() {
  flow.reset()
  void router.push('/cleanup')
}
</script>

<template>
  <section class="screen">
    <header class="page-head">
      <h1>No empty token accounts.</h1>
      <p class="lede">
        <span class="mono">{{ short(flow.addr) }}</span> has nothing to reclaim right now — either it’s new, or it was already cleaned up.
        <template v-if="flow.est?.keep || flow.est?.frozen"> Accounts that still hold tokens or are frozen stay as they are.</template>
      </p>
      <div class="actions">
        <button class="btn arrow" type="button" @click="another">Check another wallet</button>
        <button class="btn btn-ghost arrow" type="button" @click="router.push('/cleanup?mode=list')">Check a list of wallets</button>
      </div>
    </header>
  </section>
</template>

<style scoped lang="scss">
.page-head { padding-bottom: 72px; }

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 40px;

  .btn { min-width: 260px; min-height: 56px; font-size: 17px; }
  .btn.arrow::after { width: 56px; margin-top: -10px; margin-bottom: -10px; }

  @media (max-width: 560px) {
    flex-direction: column;

    .btn { min-width: 0; }
  }
}
</style>
