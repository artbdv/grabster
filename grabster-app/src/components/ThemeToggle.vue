<script setup lang="ts">
import { computed } from 'vue'
import { theme, toggleTheme } from '../lib/theme'

const dark = computed(() => theme.value === 'dark')
</script>

<template>
  <button
    class="theme-btn"
    type="button"
    :aria-label="dark ? 'Switch to light theme' : 'Switch to dark theme'"
    :title="dark ? 'Light theme' : 'Dark theme'"
    @click="toggleTheme"
  >
    <!-- Shows the theme you switch to: a moon in light, a sun in dark. -->
    <svg v-if="!dark" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
    </svg>
    <svg v-else viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.7" />
      <path
        d="M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="square"
      />
    </svg>
  </button>
</template>

<style scoped lang="scss">
.theme-btn {
  display: grid;
  place-items: center;
  width: 44px;
  padding: 0;
  border: 1px solid var(--line-3);
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;

  &:hover {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);
  }
}
</style>
