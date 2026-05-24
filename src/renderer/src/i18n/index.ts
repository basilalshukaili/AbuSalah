import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './en.json'
import ar from './ar.json'

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar }
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

export type SupportedLanguage = 'en' | 'ar'

export function applyLanguage(lang: SupportedLanguage): void {
  void i18n.changeLanguage(lang)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  document.documentElement.setAttribute('lang', lang)
  document.documentElement.setAttribute('dir', dir)
  document.body.setAttribute('lang', lang)
  document.body.setAttribute('dir', dir)
}

export default i18n
