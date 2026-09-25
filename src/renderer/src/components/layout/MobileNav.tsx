import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  BarChart3,
  FilePlus,
  LayoutDashboard,
  Menu,
  Package,
  Search,
  Settings as SettingsIcon,
  Users
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const primaryItems = [
  { to: '/', key: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/invoice/new', key: 'nav.newInvoice', icon: FilePlus },
  { to: '/search', key: 'nav.search', icon: Search },
  { to: '/products', key: 'nav.products', icon: Package }
]

const moreItems = [
  { to: '/customers', key: 'nav.customers', icon: Users },
  { to: '/reports', key: 'nav.reports', icon: BarChart3 },
  { to: '/settings', key: 'nav.settings', icon: SettingsIcon }
]

function mobileLinkClass(isActive: boolean): string {
  return cn(
    'flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-medium',
    'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent'
  )
}

export function MobileNav() {
  const { t } = useTranslation()
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreActive = moreItems.some((item) => location.pathname.startsWith(item.to))

  return (
    <>
      <nav
        aria-label={t('app.name')}
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 px-2 pt-1 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur md:hidden"
      >
        <div className="grid grid-cols-5 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
          {primaryItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => mobileLinkClass(isActive)}
            >
              <item.icon className="h-5 w-5" />
              <span className="w-full truncate text-center">{t(item.key)}</span>
            </NavLink>
          ))}
          <button
            type="button"
            className={mobileLinkClass(moreActive || moreOpen)}
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
          >
            <Menu className="h-5 w-5" />
            <span className="w-full truncate text-center">{t('common.more', { defaultValue: 'More' })}</span>
          </button>
        </div>
      </nav>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent className="bottom-[calc(4.75rem+env(safe-area-inset-bottom))] top-auto max-w-[calc(100%-1rem)] translate-y-0 p-4 md:hidden">
          <DialogHeader>
            <DialogTitle>{t('app.name')}</DialogTitle>
            <DialogDescription>
              {t('common.more', { defaultValue: 'More pages' })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-2">
            {moreItems.map((item) => {
              const active = location.pathname.startsWith(item.to)
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={cn(mobileLinkClass(active), 'min-h-24 text-sm')}
                  onClick={() => setMoreOpen(false)}
                >
                  <item.icon className="h-6 w-6" />
                  <span className="text-center">{t(item.key)}</span>
                </NavLink>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
