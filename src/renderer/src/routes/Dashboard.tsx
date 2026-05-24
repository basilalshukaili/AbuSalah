import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  FilePlus2,
  Search,
  Package,
  BarChart3,
  TrendingUp,
  Receipt,
  Wallet,
  AlertCircle
} from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { formatMoney } from '@shared/formatting'

function todayRange() {
  const t = new Date().toISOString().slice(0, 10)
  return { start: t, end: t }
}

function monthRange() {
  const today = new Date()
  const start = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)
  return { start, end: today.toISOString().slice(0, 10) }
}

function fiveYearsRange() {
  const today = new Date()
  const start = new Date(today.getFullYear() - 5, today.getMonth(), 1).toISOString().slice(0, 10)
  return { start, end: today.toISOString().slice(0, 10) }
}

interface KpiCardProps {
  title: string
  value: string
  icon: React.ComponentType<{ className?: string }>
  accent?: 'amber' | 'emerald' | 'rose' | 'slate'
}

function KpiCard({ title, value, icon: Icon, accent = 'slate' }: KpiCardProps) {
  const accentClasses: Record<string, string> = {
    amber: 'text-amber-500 bg-amber-500/10',
    emerald: 'text-emerald-500 bg-emerald-500/10',
    rose: 'text-rose-500 bg-rose-500/10',
    slate: 'text-slate-500 bg-slate-500/10'
  }
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-muted-foreground">{title}</div>
            <div className="text-3xl font-bold mt-1 tracking-tight">{value}</div>
          </div>
          <div className={`p-3 rounded-xl ${accentClasses[accent]}`}>
            <Icon className="h-6 w-6" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function Dashboard() {
  const { t } = useTranslation()

  const today = todayRange()
  const month = monthRange()
  const allRange = fiveYearsRange()

  const { data: todayKpis } = useQuery({
    queryKey: ['kpis', 'today'],
    queryFn: () => window.api.reportsKpis(today)
  })
  const { data: monthKpis } = useQuery({
    queryKey: ['kpis', 'month'],
    queryFn: () => window.api.reportsKpis(month)
  })
  const { data: outstandingKpis } = useQuery({
    queryKey: ['kpis', 'outstanding'],
    queryFn: () => window.api.reportsKpis(allRange)
  })
  const { data: recent } = useQuery({
    queryKey: ['invoices', 'recent'],
    queryFn: () => window.api.invoicesSearch({ limit: 8 })
  })
  const { data: lowStock } = useQuery({
    queryKey: ['products', 'low'],
    queryFn: () => window.api.productsList({ lowStockOnly: true })
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('nav.dashboard')}</h1>
        <p className="text-muted-foreground mt-1">{t('app.tagline')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title={t('dashboard.todaySales')}
          value={formatMoney(todayKpis?.totalSales ?? 0)}
          icon={TrendingUp}
          accent="amber"
        />
        <KpiCard
          title={t('dashboard.todayInvoices')}
          value={String(todayKpis?.invoiceCount ?? 0)}
          icon={Receipt}
          accent="slate"
        />
        <KpiCard
          title={t('dashboard.monthSales')}
          value={formatMoney(monthKpis?.totalSales ?? 0)}
          icon={BarChart3}
          accent="emerald"
        />
        <KpiCard
          title={t('dashboard.outstanding')}
          value={formatMoney(outstandingKpis?.totalBalance ?? 0)}
          icon={Wallet}
          accent="rose"
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Button asChild size="lg" className="h-16 text-base font-semibold">
          <Link to="/invoice/new">
            <FilePlus2 className="h-5 w-5" />
            {t('dashboard.quickNew')}
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="h-16 text-base">
          <Link to="/search">
            <Search className="h-5 w-5" />
            {t('dashboard.quickSearch')}
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="h-16 text-base">
          <Link to="/products">
            <Package className="h-5 w-5" />
            {t('dashboard.quickProducts')}
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="h-16 text-base">
          <Link to="/reports">
            <BarChart3 className="h-5 w-5" />
            {t('dashboard.quickReports')}
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t('dashboard.recentInvoices')}</CardTitle>
            <Button asChild variant="ghost" size="sm" className="gap-1">
              <Link to="/search">
                {t('common.search')} <ArrowRight className="h-4 w-4 rtl:rotate-180" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {recent && recent.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('invoice.number')}</TableHead>
                    <TableHead>{t('invoice.date')}</TableHead>
                    <TableHead>{t('customers.name')}</TableHead>
                    <TableHead className="text-end">{t('invoice.total')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-medium">#{inv.number}</TableCell>
                      <TableCell>{(inv.date || '').slice(0, 10)}</TableCell>
                      <TableCell>{inv.customerName || '—'}</TableCell>
                      <TableCell className="text-end font-mono">
                        {formatMoney(inv.total)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="py-10 text-center text-muted-foreground">
                {t('dashboard.noActivity')}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-rose-500" />
              {t('dashboard.lowStock')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {lowStock && lowStock.length > 0 ? (
              <ul className="space-y-2">
                {lowStock.slice(0, 12).map((p) => (
                  <li
                    key={p.id}
                    className="flex justify-between items-center py-1.5 border-b border-border/50 last:border-0"
                  >
                    <span className="truncate me-2">{p.nameAr || p.name}</span>
                    <span className="font-mono font-semibold text-rose-500">{p.qty}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {t('dashboard.noLowStock')}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
