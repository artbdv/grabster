<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { rememberRef } from '../lib/ref'

const route = useRoute()
const router = useRouter()

onMounted(() => {
  rememberRef(String(route.params.code || ''))
  void router.replace('/')
})
</script>

<template>
  <section class="screen">
    <div class="card center">
      <p class="muted">Taking you in…</p>
    </div>
  </section>
</template>
