import { Languages, Moon, Smartphone, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { isMobileBrowser } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'

export function TopBar() {
  const { t, i18n } = useTranslation()
  const settings = useAppStore((state) => state.settings)
  const setLanguage = useAppStore((state) => state.setLanguage)
  const setTheme = useAppStore((state) => state.setTheme)
  const isDark = settings?.theme === 'dark'
  const isAr = i18n.language === 'ar'

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b bg-card px-3 md:h-14 md:px-6">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2 md:hidden">
          {isMobileBrowser && <Smartphone className="h-4 w-4 shrink-0 text-success" />}
          <span className="truncate text-sm font-semibold">
            {settings?.businessName || t('app.name')}
          </span>
        </div>
        <div className="hidden truncate text-sm font-medium text-muted-foreground md:block">
          {t('dashboard.welcome')}
          {settings?.businessName ? ` · ${settings.businessName}` : ''}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <Button
          variant="ghost"
          onClick={() => setLanguage(isAr ? 'en' : 'ar')}
          aria-label="Toggle language"
          className="h-11 min-w-11 gap-1 px-3"
        >
          <Languages className="h-4 w-4" />
          <span className="text-sm">{isAr ? 'EN' : 'AR'}</span>
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
