import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const from = resolve(here, '../dist/index.html')
const to = resolve(here, '../../grabster-app/public/grabster.html')
mkdirSync(dirname(to), { recursive: true })
copyFileSync(from, to)
