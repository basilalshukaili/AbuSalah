import { create } from 'zustand'

import type { Settings } from '@shared/types'
import { applyLanguage } from '@/i18n'

interface AppState {
  settings: Settings | null
  loading: boolean
  loadSettings: () => Promise<void>
  updateSettings: (patch: Partial<Settings>) => Promise<void>
  setLanguage: (lang: 'en' | 'ar') => Promise<void>
  setTheme: (theme: 'light' | 'dark') => Promise<void>
  setFontSize: (px: number) => Promise<void>
}

function applyTheme(theme: 'light' | 'dark') {
  if (theme === 'dark') document.documentElement.classList.add('dark')
  else document.documentElement.classList.remove('dark')
}

function applyFontSize(px: number) {
  document.documentElement.style.fontSize = `${px}px`
}

export const useAppStore = create<AppState>((set, get) => ({
  settings: null,
  loading: true,

  loadSettings: async () => {
    set({ loading: true })
    const settings = await window.api.settingsGetAll()
    applyTheme(settings.theme)
    applyLanguage(settings.language)
    applyFontSize(settings.fontSize)
    set({ settings, loading: false })
  },

  updateSettings: async (patch) => {
    const updated = await window.api.settingsUpdate(patch)
    if (patch.theme) applyTheme(updated.theme)
    if (patch.language) applyLanguage(updated.language)
    if (patch.fontSize) applyFontSize(updated.fontSize)
    set({ settings: updated })
  },

  setLanguage: async (lang) => {
    await get().updateSettings({ language: lang })
  },

  setTheme: async (theme) => {
    await get().updateSettings({ theme })
  },

  setFontSize: async (px) => {
    await get().updateSettings({ fontSize: px })
  }
}))
