import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { viteSingleFile } from 'vite-plugin-singlefile'

const root = fileURLToPath(new URL('..', import.meta.url))
/** UTC date of this build, shown in the file header and footer. */
const build = new Date().toISOString().slice(0, 10)

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, '')
  return {
    base: './',
    envDir: root,
    define: {
      __GRABSTER_FEE_PERCENT__: JSON.stringify(env.FEE_DIRECT ?? ''),
      __GRABSTER_TREASURY__: JSON.stringify(env.TREASURY_ADDRESS ?? ''),
    },
    plugins: [
      {
        name: 'grabster-build-date',
        transformIndexHtml: (html) => html.replaceAll('__GRABSTER_BUILD__', build),
      },
      nodePolyfills({ globals: { Buffer: true, global: true, process: true } }),
      viteSingleFile(),
    ],
    build: {
      cssCodeSplit: false,
      assetsInlineLimit: 100000000,
    },
  }
})
