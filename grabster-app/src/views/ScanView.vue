<script setup lang="ts">
import { useStateStore } from '../stores'

const flow = useStateStore()
const steps = ['Reading token accounts', 'Finding empty accounts', 'Checking balances and prices', 'Checking frozen and protected tokens', 'Adding up the rent']
</script>

<template>
  <section class="screen">
    <header class="page-head">
      <h1>Checking the wallet.</h1>
      <p class="mono addr">{{ flow.addr }}</p>
    </header>
    <ol class="scan-steps" aria-live="polite">
      <li v-for="(s, i) in steps" :key="s" :class="{ on: i <= flow.scanStep, now: i === Math.min(flow.scanStep, steps.length - 1) }">
        <span class="status" :data-s="i < flow.scanStep ? 'ok' : i === Math.min(flow.scanStep, steps.length - 1) ? 'wait' : 'none'">{{ s }}</span>
      </li>
    </ol>
    <p class="hint">Read-only: this uses public chain data. Nothing is signed.</p>
  </section>
</template>

<style scoped lang="scss">
.addr {
  margin-top: 28px;
  font-size: 15px;
  color: var(--ink-2);
  overflow-wrap: anywhere;
}

/* One row per step, edge to edge, each on its own rule. */
.scan-steps {
  list-style: none;
  margin: 0;
  padding: 0;

  li {
    display: flex;
    align-items: center;
    min-height: 64px;
    padding: 16px var(--gutter);
    border-bottom: 1px solid var(--line-2);
  }

  /* Steps not reached yet read as muted text (status "none"), not faded out. */
  .status { font-size: 13px; white-space: normal; }

  li.now { background: var(--surface); }
}

.hint { margin: 0; padding: 20px var(--gutter) 64px; }
</style>
