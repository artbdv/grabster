/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly [key: `VITE_${string}`]: string | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
