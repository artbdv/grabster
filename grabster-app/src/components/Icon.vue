<script setup lang="ts">
import { computed } from 'vue'

export type IconName = 'box' | 'boxOpen' | 'dust' | 'frame' | 'snow' | 'spark' | 'lock' | 'shield' | 'stack' | 'link' | 'land' | 'send' | 'key' | 'receipt' | 'refresh' | 'logout' | 'wallet'

const props = withDefaults(defineProps<{ name: IconName; color?: string; small?: boolean }>(), { color: 'currentColor', small: false })

const icons: Record<IconName, (c: string) => string> = {
  box: (c) => `<path d="M14 3 25 8.5v11L14 25 3 19.5v-11z" fill="${c}" opacity=".35"/><path d="M14 3 25 8.5 14 14 3 8.5z" fill="${c}"/><path d="M14 14v11L3 19.5v-11z" fill="${c}" opacity=".6"/>`,
  boxOpen: (c) => `<path d="M14 10 25 15v6L14 26 3 21v-6z" fill="${c}" opacity=".35"/><path d="M14 16v10L3 21v-6z" fill="${c}" opacity=".6"/><path d="M3 15 1 9l8-3 5 4z" fill="${c}"/><path d="M25 15l2-6-8-3-5 4z" fill="${c}"/><circle cx="14" cy="7" r="4" fill="${c}"/><circle cx="14" cy="7" r="1.6" style="fill:var(--bg)"/>`,
  land: (c) => `<path d="M5 16h18v7H5z" fill="${c}" opacity=".35"/><path d="M4 16 14 9l10 7v2H4z" fill="${c}"/><path d="M14 3v10" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="square"/><path d="M10 9l4 4 4-4" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="square" stroke-linejoin="miter"/>`,
  send: (c) => `<path d="M4 24 24 14 4 4l4 10z" fill="${c}" opacity=".4"/><path d="M4 24 24 14 8 14z" fill="${c}"/><path d="M8 14 4 4l8 8z" fill="${c}" opacity=".75"/>`,
  dust: (c) => `<path d="M4 20c5 0 6-8 12-8s7 6 8 6" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="square"/><circle cx="7" cy="9" r="2.2" fill="${c}" opacity=".7"/><circle cx="14" cy="6" r="1.6" fill="${c}" opacity=".7"/><circle cx="22" cy="10" r="2.6" fill="${c}" opacity=".7"/><circle cx="18" cy="22" r="1.4" fill="${c}"/>`,
  frame: (c) => `<rect x="4" y="4" width="20" height="20" fill="${c}" opacity=".35"/><rect x="7" y="7" width="14" height="14" style="fill:var(--bg)"/><path d="M8 19l4-5 3 3 2-2 3 4z" fill="${c}"/><circle cx="17" cy="11" r="1.8" fill="${c}"/>`,
  snow: (c) => `<g stroke="${c}" stroke-width="2" stroke-linecap="square"><path d="M14 3v22M4.5 8.5l19 11M4.5 19.5l19-11"/><path d="M11 5l3 3 3-3M11 23l3-3 3 3M4 13l3-1 1-3M24 15l-3 1-1 3M4 15l3 1 1 3M24 13l-3-1-1-3"/></g>`,
  spark: (c) => `<path d="M14 2c1 7 5 11 12 12-7 1-11 5-12 12-1-7-5-11-12-12 7-1 11-5 12-12z" fill="${c}"/>`,
  lock: (c) => `<g transform="scale(1.4)"><rect x="4" y="9" width="12" height="9" fill="${c}" opacity=".9"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9" fill="none" stroke="${c}" stroke-width="2"/><circle cx="10" cy="13.5" r="1.5" style="fill:var(--bg)"/></g>`,
  shield: (c) => `<g transform="scale(1.4)"><path d="M10 1.5 17 4v5c0 4.5-3 7.8-7 9.5-4-1.7-7-5-7-9.5V4z" fill="${c}"/><path d="M6.5 10l2.3 2.3L13.8 7.5" fill="none" style="stroke:var(--bg)" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"/></g>`,
  key: (c) => `<circle cx="9.5" cy="14" r="5.5" fill="none" stroke="${c}" stroke-width="2.2"/><circle cx="9.5" cy="14" r="1.8" fill="${c}"/><path d="M14.5 14h9l-2.2 2.4M19 14v3.6" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="square" stroke-linejoin="miter"/>`,
  receipt: (c) => `<path d="M7 3h14v22l-2.2-1.6-2.2 1.6-2.2-1.6-2.2 1.6-2.2-1.6-3 2.2z" fill="${c}" opacity=".35"/><path d="M8 4h12v19.2l-1.6-1.1-2 1.4-2-1.4-2 1.4-2-1.4-2.4 1.6z" fill="${c}"/><path d="M11 9h6M11 13h6M11 17h4" fill="none" style="stroke:var(--bg)" stroke-width="1.8" stroke-linecap="square"/>`,
  stack: (c) => `<path d="M8 17l6-3 6 3v4l-6 3-6-3z" fill="${c}" opacity=".5"/><path d="M14 17v7l-6-3v-4z" fill="${c}" opacity=".8"/><path d="M12 9l6-3 6 3v4l-6 3-6-3z" fill="${c}"/><path d="M18 12v4l-6-3V9z" fill="${c}" opacity=".6"/><circle cx="7" cy="7" r="3" fill="${c}"/>`,
  link: (c) => `<path d="M11 17l6-6M9 12l-2 2a4.2 4.2 0 0 0 6 6l2-2M19 16l2-2a4.2 4.2 0 0 0-6-6l-2 2" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="square"/>`,
  refresh: (c) => `<g fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="square" stroke-linejoin="miter"><path d="M21.5 9.2A8.2 8.2 0 1 0 23 15"/><path d="M21.5 4.5v5.2h-5.2"/></g>`,
  logout: (c) => `<g fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="square" stroke-linejoin="miter"><path d="M12 5H8.2A3.2 3.2 0 0 0 5 8.2v11.6A3.2 3.2 0 0 0 8.2 23H12"/><path d="M13 14h10M19.5 9.5 24 14l-4.5 4.5"/></g>`,
  wallet: (c) => `<g fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="square" stroke-linejoin="miter"><rect x="3.5" y="7" width="21" height="15"/><path d="M3.5 11.5h21"/><path d="M20 16.5h.01" stroke-width="3.2"/></g>`,
}

const svg = computed(() => icons[props.name](props.color))
</script>

<template>
  <svg :class="small ? 'ic ic-sm' : 'ic'" viewBox="0 0 28 28" aria-hidden="true" v-html="svg" />
</template>

<style scoped lang="scss">
.ic {
  width: 26px;
  height: 26px;
  display: block;
}

.ic-sm {
  width: 16px;
  height: 16px;
}
</style>
