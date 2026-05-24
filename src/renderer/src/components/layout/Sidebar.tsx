import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  FilePlus,
  Search,
  Package,
  Users,
  BarChart3,
  Settings as SettingsIcon
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

const items = [
  { to: '/', key: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/invoice/new', key: 'nav.newInvoice', icon: FilePlus },
  { to: '/search', key: 'nav.search', icon: Search },
  { to: '/products', key: 'nav.products', icon: Package },
  { to: '/customers', key: 'nav.customers', icon: Users },
  { to: '/reports', key: 'nav.reports', icon: BarChart3 },
  { to: '/settings', key: 'nav.settings', icon: SettingsIcon }
]

export function Sidebar() {
  const { t } = useTranslation()

  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col border-e bg-secondary text-secondary-foreground">
      <div className="flex flex-col gap-1 px-3 py-4">
        <div className="px-3 py-3 mb-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg shadow">
            AS
          </div>
          <div className="leading-tight">
            <div className="text-base font-semibold">{t('app.name')}</div>
            <div className="text-xs text-muted-foreground">{t('app.tagline')}</div>
          </div>
        </div>

        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                'hover:bg-secondary-foreground/10',
                isActive &&
                  'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
              )
            }
          >
            <item.icon className="h-5 w-5" />
            <span>{t(item.key)}</span>
          </NavLink>
        ))}
      </div>

      <div className="mt-auto p-4 text-xs text-muted-foreground border-t">
        v2.0.0
      </div>
    </aside>
  )
}
