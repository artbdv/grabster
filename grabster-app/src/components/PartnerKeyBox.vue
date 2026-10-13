<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { fetchPartnerKey, rotatePartnerKey } from '../lib/api'
import { useAuthStore, useUiStore } from '../stores'

const emit = defineEmits<{ key: [value: string] }>()

const auth = useAuthStore()
const ui = useUiStore()
const apiKey = ref('')
const keyErr = ref('')
const keyBusy = ref(false)
const shown = ref(false)
const armRotate = ref(false)
const inputId = useId()

const masked = computed(() => {
  const value = apiKey.value
  if (!value) return ''
  if (value.length < 12) return '••••••••'
  return `${value.slice(0, 6)}${'•'.repeat(12)}${value.slice(-4)}`
})

watch(apiKey, (value) => emit('key', value))

watch(() => auth.address, (address) => {
  armRotate.value = false
  shown.value = false
  if (!address) {
    apiKey.value = ''
    keyErr.value = ''
    return
  }
  void loadKey()
}, { immediate: true })

async function loadKey() {
  if (!auth.address) return
  keyBusy.value = true
  keyErr.value = ''
  try {
    apiKey.value = (await fetchPartnerKey()).key
  } catch (e) {
    apiKey.value = ''
    keyErr.value = e instanceof Error ? e.message : 'Could not create an API key.'
  } finally {
    keyBusy.value = false
  }
}

async function replaceKey() {
  keyBusy.value = true
  keyErr.value = ''
  try {
    apiKey.value = (await rotatePartnerKey()).key
    shown.value = true
    armRotate.value = false
    ui.showToast('New key. The old one stopped working.')
  } catch (e) {
    keyErr.value = e instanceof Error ? e.message : 'Could not replace the key.'
  } finally {
    keyBusy.value = false
  }
}

function copy() {
  if (!apiKey.value) return
  try { navigator.clipboard?.writeText(apiKey.value) } catch { /* clipboard may be blocked */ }
  ui.showToast('Copied')
}
</script>

<template>
  <div class="keybox">
    <template v-if="auth.address">
      <label class="field-label" :for="inputId">Your API key</label>
      <div class="keyline">
        <input
          :id="inputId"
          class="input"
          readonly
          spellcheck="false"
          autocomplete="off"
          :aria-busy="keyBusy"
          :value="keyBusy && !apiKey ? 'Creating your key…' : (shown ? apiKey : masked)"
        />
        <button class="btn btn-sm btn-ghost" type="button" :disabled="!apiKey" :aria-pressed="shown" @click="shown = !shown">{{ shown ? 'Hide' : 'Show' }}</button>
        <button class="btn btn-sm" type="button" :disabled="!apiKey" @click="copy">Copy</button>
      </div>
      <p class="hint">
        One key per wallet. The API and MCP both use it. Send it as
        <code class="inline">Authorization: Bearer …</code>. Keep it on your side — anyone holding it uses your rate limit.
      </p>
      <div class="key-actions">
        <template v-if="!armRotate">
          <button class="btn btn-sm btn-ghost" type="button" :disabled="keyBusy || !apiKey" @click="armRotate = true">New key</button>
        </template>
        <template v-else>
          <span>The old key stops working.</span>
          <button class="btn btn-sm" type="button" :disabled="keyBusy" @click="replaceKey">Replace</button>
          <button class="btn btn-sm btn-ghost" type="button" @click="armRotate = false">Cancel</button>
        </template>
      </div>
    </template>
    <template v-else>
      <p class="label">API key</p>
      <p class="signed-out">Sign in with a wallet. Grabster creates one key for it. The API and MCP use that same key.</p>
      <button class="btn arrow" type="button" :disabled="auth.busy" @click="auth.login()">Sign in with wallet</button>
    </template>
    <p v-if="keyErr" class="err" role="alert">{{ keyErr }}</p>
  </div>
</template>

<style scoped lang="scss">
/* Open group: the field and its buttons butt together into one rectangle. */
.keybox {
  min-width: 0;
}

.keyline {
  display: flex;
  align-items: stretch;

  .input { flex: 1; min-width: 0; }

  /* The key sits on white, like the other copyable fields. */
  .input,
  .input[readonly] { background: var(--field); }

  .btn { flex: none; min-height: 52px; min-width: 76px; justify-content: center; margin-left: -1px; }
}

.hint code.inline { white-space: normal; }

.key-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 10px;
  margin-top: 16px;
  color: var(--ink-2);
  font-size: 14px;
}

.signed-out {
  margin: 10px 0 20px;
  color: var(--ink-2);
  font-size: 17px;
  line-height: 1.45;
  max-width: 52ch;
}

@media (max-width: 560px) {
  .keyline { flex-wrap: wrap; }
  .keyline .input { width: 100%; flex: none; }
  .keyline .btn { flex: 1; margin: -1px 0 0; }
  .keyline .btn + .btn { margin-left: -1px; }
}
</style>
