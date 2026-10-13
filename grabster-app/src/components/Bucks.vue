<script setup lang="ts">
import { computed } from 'vue'
import { bucks } from '../lib/mock'
import { useStateStore } from '../stores'

const props = withDefaults(defineProps<{ sol: number; paren?: boolean }>(), { paren: false })
const flow = useStateStore()
const text = computed(() => {
  const b = bucks(props.sol, flow.solUsd)
  if (!b) return ''
  return props.paren ? ` (${b})` : b
})
</script>

<template>
  <span v-if="text" class="bucks">{{ text }}</span>
</template>

<style scoped lang="scss">
.bucks {
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
</style>
