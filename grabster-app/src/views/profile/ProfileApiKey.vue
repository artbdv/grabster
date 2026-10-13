<script setup lang="ts">
import { computed } from 'vue'
import PartnerKeyBox from '../../components/PartnerKeyBox.vue'
import { useStateStore } from '../../stores'

const flow = useStateStore()
const cfg = computed(() => flow.cfg)
const limits = computed(() => cfg.value.limits)
</script>

<template>
  <div class="pane">
    <section class="page-section" aria-labelledby="key-title">
      <p class="kicker"><span>01</span>API key</p>
      <div class="split">
        <div>
          <h2 id="key-title">One key for the API and MCP.</h2>
          <p class="muted intro">
            Grabster issues one key per signed-in wallet. Call the partner API from your code, or connect an AI client
            through MCP, with the same key. Replacing it stops the old key at once, so update it wherever you use it.
          </p>

          <dl class="kv facts">
            <div><dt>Access</dt><dd>Free: no subscription, no per-request charge</dd></div>
            <div><dt>Grabster fee</dt><dd>{{ cfg.feeDirect }}% of recovered rent, inside each plan</dd></div>
            <template v-if="limits">
              <div><dt>Rate limit</dt><dd>{{ limits.partnerPerMin }} requests / min per key</dd></div>
              <div><dt>Batch scan</dt><dd>Up to {{ limits.partnerBatch }} addresses</dd></div>
              <div><dt>Plan lifetime</dt><dd>{{ limits.planTtlSec }} s, then rebuild</dd></div>
            </template>
          </dl>
          <p class="hint">
            The fee is a transfer inside the transaction the owner signs, shown in the plan before signing. Solana network
            fees are separate.
          </p>

          <div class="cta">
            <router-link class="btn btn-sm btn-ghost arrow" to="/api">API docs</router-link>
            <router-link class="btn btn-sm btn-ghost arrow" to="/mcp">MCP setup</router-link>
          </div>
        </div>

        <div class="box">
          <PartnerKeyBox />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
h2 { max-width: 14ch; }

.intro {
  margin-top: 24px;
  font-size: 16px;
  color: var(--ink-2);
  max-width: 56ch;
}

.facts {
  margin-top: 32px;
}

.cta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 28px;
}

.box { min-width: 0; }
</style>
