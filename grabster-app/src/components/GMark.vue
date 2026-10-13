<script setup lang="ts">
/**
 * The Grabster G: four massive ribbons of one width, every cut at 45°, clear gaps —
 * the construction language of the reference mark, drawn as a G with an inner crossbar.
 * Geometry from tools/brand/gen-g.cjs.
 */
const D = 'M48 32.48L47.45 33.04L36.84 22.43L34.43 24.84L45.04 35.45L32.48 48L17.52 48L16.96 47.45L27.57 36.84L26.73 36L27.51 36L29.51 34L27 34L27 22L48 22ZM11.16 27.57L12.61 26.12L22.49 36L23.6 36L14.56 45.04L0 30.48L0 17.52L0.56 16.96ZM12 22.49L12 23.6L2.96 14.56L17.52 0L48 0L36 12L22.49 12Z'

withDefaults(defineProps<{ size?: number; title?: string }>(), { size: 28, title: '' })
</script>

<template>
  <svg
    class="gmark"
    viewBox="0 0 48 48"
    :width="size"
    :height="size"
    fill="currentColor"
    :role="title ? 'img' : undefined"
    :aria-hidden="title ? undefined : 'true'"
    :aria-label="title || undefined"
  ><path :d="D" /></svg>
</template>

<style scoped>
.gmark { display: block; flex: none; }
</style>
