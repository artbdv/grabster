import { ref } from 'vue'

export type Theme = 'light' | 'dark'

/** Set only by the header switch, so a stored value is always the visitor's own choice. */
const KEY = 'grabster-theme-choice'
const META = { light: '#F0EFEB', dark: '#121211' } as const

/** The current theme (dark unless the visitor chose light). index.html applied it before first paint. */
export const theme = ref<Theme>(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

export function setTheme(next: Theme) {
  theme.value = next
  const root = document.documentElement
  if (next === 'dark') root.dataset.theme = 'dark'
  else delete root.dataset.theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META[next])
  try {
    localStorage.setItem(KEY, next)
    localStorage.removeItem('grabster-theme') // the old key never counts as a choice
  } catch { /* storage may be blocked; the choice lasts this visit */ }
}

export function toggleTheme() {
  setTheme(theme.value === 'dark' ? 'light' : 'dark')
}
