import { useTranslation } from 'react-i18next'
import { Languages, Moon, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/app-store'

export function TopBar() {
  const { t, i18n } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const setLanguage = useAppStore((s) => s.setLanguage)
  const setTheme = useAppStore((s) => s.setTheme)
  const isDark = settings?.theme === 'dark'
  const isAr = i18n.language === 'ar'

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-4 md:px-6">
      <div className="flex items-center gap-3">
        <div className="text-sm font-medium text-muted-foreground">
          {t('dashboard.welcome')}
          {settings?.businessName ? ` · ${settings.businessName}` : ''}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLanguage(isAr ? 'en' : 'ar')}
          aria-label="Toggle language"
          className="gap-2"
        >
          <Languages className="h-4 w-4" />
          {isAr ? 'EN' : 'AR'}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
          aria-label="Toggle theme"
        >
          {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>
      </div>
    </header>
  )
}
