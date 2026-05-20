import { get, writable } from 'svelte/store'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'rfict-theme'

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export const themeStore = writable<Theme>(getInitialTheme())

if (typeof window !== 'undefined') {
  themeStore.subscribe((theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(STORAGE_KEY, theme)
  })
}

export function toggleTheme() {
  themeStore.set(get(themeStore) === 'dark' ? 'light' : 'dark')
}
