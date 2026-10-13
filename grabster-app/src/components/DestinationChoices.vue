<script setup lang="ts">
import { computed } from 'vue'
import { type Destination } from '../lib/mock'
import { useAuthStore, useStateStore } from '../stores'

const flow = useStateStore()
const auth = useAuthStore()

/** `same` is offered in both modes; in a list (`list`) it means "each wallet keeps its own SOL". */
const props = defineProps<{ allowSame?: boolean; list?: boolean }>()

const options = computed(() => {
  const list: { id: Destination; title: string; sub: string; fee: number; tag?: string }[] = []
  if (props.allowSame) {
    list.push({
      id: 'same',
      title: props.list ? 'Back to each wallet' : 'Back to this wallet',
      sub: props.list ? 'Every wallet receives the SOL from its own accounts.' : 'The SOL returns to the wallet it came from.',
      fee: flow.cfg.feeDirect,
    })
  }
  list.push({
    id: 'other',
    title: 'Another address',
    sub: props.list ? 'One address receives the SOL from every wallet in the list.' : 'For example, your main wallet.',
    fee: flow.cfg.feeDirect,
  })
  if (flow.cfg.features.balance) {
    list.push({
      id: 'balance',
      title: 'Grabster balance',
      sub: 'Not a wallet: the SOL is credited to an internal balance that Grabster holds for your signed-in address. Withdraw it later from Profile.',
      fee: flow.cfg.feeBalance,
      tag: 'Held by Grabster',
    })
  }
  return list
})

function onOther(e: Event) {
  flow.other = (e.target as HTMLInputElement).value.trim()
  flow.otherInvalid = false
}
</script>

<template>
  <fieldset class="dest">
    <legend class="sr-only">Where the SOL goes</legend>
    <label v-for="o in options" :key="o.id" class="choice" :class="{ held: o.id === 'balance' }">
      <input v-model="flow.dest" type="radio" name="dest" :value="o.id" />
      <span class="ring" aria-hidden="true"></span>
      <span class="text">
        <b>{{ o.title }}<span v-if="o.tag" class="badge">{{ o.tag }}</span></b>
        <small>{{ o.sub }}</small>
      </span>
      <span class="fee mono">{{ o.fee }}% fee</span>
    </label>
  </fieldset>
  <p v-if="flow.dest === 'balance' && !auth.address" class="dest-hint">
    You’ll sign in with a wallet first. The credit goes to that signed-in address — not to the wallets in this cleanup.
  </p>
  <div v-if="flow.dest === 'other'" class="sub-input">
    <label class="sr-only" for="dest-other">Recipient address</label>
    <input
      id="dest-other"
      class="input"
      :class="{ invalid: flow.otherInvalid }"
      placeholder="Recipient address"
      :value="flow.other"
      spellcheck="false"
      autocomplete="off"
      :aria-invalid="flow.otherInvalid"
      @input="onOther"
    />
    <p v-if="flow.otherInvalid" class="err">That isn’t a valid Solana address.</p>
  </div>
</template>

<style scoped lang="scss">
.dest {
  border: 0;
  margin: 0;
  padding: 0;
  display: grid;
  border-top: 1px solid var(--line-2);
  min-width: 0;
}

/* One row per destination; the picked one shows a purple square and a lighter field. */
.choice {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  gap: 16px;
  align-items: start;
  padding: 18px 16px;
  border-bottom: 1px solid var(--line-2);
  cursor: pointer;
  position: relative;
  transition: background 0.15s;

  &:hover { background: var(--surface); }

  input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .ring {
    width: 18px;
    height: 18px;
    margin-top: 2px;
    border: 1.5px solid var(--line-3);
    background: var(--surface);
    display: grid;
    place-items: center;
    transition: border-color 0.15s, background 0.15s;

    &::after {
      content: '';
      width: 6px;
      height: 6px;
      background: var(--accent-ink);
      transform: scale(0);
      transition: transform 0.12s;
    }
  }

  &:hover .ring { border-color: var(--ink); }

  &:has(input:checked) {
    background: var(--surface);

    .ring { background: var(--accent); border-color: var(--accent); }
    .ring::after { transform: scale(1); }
    b { color: var(--ink); }
    .fee { color: var(--ink); }
  }

  &:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .text { min-width: 0; }

  b {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    font-weight: 600;
    font-size: 17px;
    letter-spacing: -0.015em;
    color: var(--ink);
  }

  small {
    display: block;
    margin-top: 4px;
    color: var(--muted);
    font-size: 14px;
    line-height: 1.45;
  }

  .fee {
    font-size: 13px;
    color: var(--ink-2);
    white-space: nowrap;
    padding-top: 3px;
  }
}

.dest-hint {
  margin: 12px 0 0;
  font-size: 14px;
  color: var(--muted);
}

.sub-input {
  margin-top: 14px;
  min-width: 0;
}

.input { background: var(--field); }
.input.invalid { border-color: var(--bad); }
</style>
