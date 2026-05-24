import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Download, Search } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { toast } from 'sonner'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { formatMoney } from '@shared/formatting'

function thirtyDaysAgo() {
  const d = new Date(Date.now() - 30 * 86400_000)
  return d.toISOString().slice(0, 10)
}

export function Reports() {
  const { t } = useTranslation()
  const [from, setFrom] = useState(thirtyDaysAgo())
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const range = { start: from, end: to }

  const { data: kpis } = useQuery({
    queryKey: ['reports', 'kpis', from, to],
    queryFn: () => window.api.reportsKpis(range)
  })
  const { data: byDay } = useQuery({
    queryKey: ['reports', 'day', from, to],
    queryFn: () => window.api.reportsSalesByDay(range)
  })
  const { data: byMonth } = useQuery({
    queryKey: ['reports', 'month', from, to],
    queryFn: () => window.api.reportsSalesByMonth(range)
  })
  const { data: topProducts } = useQuery({
    queryKey: ['reports', 'top-products', from, to],
    queryFn: () => window.api.reportsTopProducts(range, 20)
  })
  const { data: topCustomers } = useQuery({
    queryKey: ['reports', 'top-customers', from, to],
    queryFn: () => window.api.reportsTopCustomers(range, 20)
  })

  async function exportXlsx() {
    try {
      const path = await window.api.reportsExportExcel(range)
      toast.success(path)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">{t('reports.title')}</h1>

      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-3">
            <Label htmlFor="rfrom">{t('search.from')}</Label>
            <Input id="rfrom" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="md:col-span-3">
            <Label htmlFor="rto">{t('search.to')}</Label>
            <Input id="rto" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="md:col-span-3">
            <Button size="lg" className="w-full" onClick={() => undefined}>
              <Search className="h-4 w-4" />
              {t('common.search')}
            </Button>
          </div>
          <div className="md:col-span-3">
            <Button size="lg" variant="outline" className="w-full" onClick={exportXlsx}>
              <Download className="h-4 w-4" />
              {t('reports.exportExcel')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiBox title={t('reports.invoiceCount')} value={String(kpis?.invoiceCount ?? 0)} />
        <KpiBox title={t('reports.totalSales')} value={formatMoney(kpis?.totalSales ?? 0)} />
        <KpiBox title={t('reports.tax')} value={formatMoney(kpis?.totalTax ?? 0)} />
        <KpiBox title={t('reports.outstanding')} value={formatMoney(kpis?.totalBalance ?? 0)} />
      </div>

      <Tabs defaultValue="daily" className="w-full">
        <TabsList>
          <TabsTrigger value="daily">{t('reports.daily')}</TabsTrigger>
          <TabsTrigger value="monthly">{t('reports.monthly')}</TabsTrigger>
          <TabsTrigger value="products">{t('reports.topProducts')}</TabsTrigger>
          <TabsTrigger value="customers">{t('reports.topCustomers')}</TabsTrigger>
        </TabsList>

        <TabsContent value="daily">
          <Card>
            <CardHeader>
              <CardTitle>{t('reports.daily')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {byDay && byDay.length > 0 && (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byDay} margin={{ left: 8, right: 8, top: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis dataKey="day" fontSize={12} />
                      <YAxis fontSize={12} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="total" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <SalesTable rows={byDay ?? []} firstCol={t('invoice.date')} keyFn={(r) => r.day} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="monthly">
          <Card>
            <CardHeader>
              <CardTitle>{t('reports.monthly')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {byMonth && byMonth.length > 0 && (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byMonth} margin={{ left: 8, right: 8, top: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis dataKey="month" fontSize={12} />
                      <YAxis fontSize={12} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="total" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <SalesTable rows={byMonth ?? []} firstCol="Month" keyFn={(r) => r.month} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="products">
          <Card>
            <CardHeader>
              <CardTitle>{t('reports.topProducts')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('products.name')}</TableHead>
                    <TableHead className="text-end">{t('invoice.qty')}</TableHead>
                    <TableHead className="text-end">{t('reports.totalSales')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(topProducts ?? []).map((p) => (
                    <TableRow key={p.name}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-end font-mono">{p.qty}</TableCell>
                      <TableCell className="text-end font-mono">{formatMoney(p.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="customers">
          <Card>
            <CardHeader>
              <CardTitle>{t('reports.topCustomers')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('customers.name')}</TableHead>
                    <TableHead>{t('customers.phone')}</TableHead>
                    <TableHead className="text-end">{t('reports.invoiceCount')}</TableHead>
                    <TableHead className="text-end">{t('reports.totalSales')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(topCustomers ?? []).map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name || '—'}</TableCell>
                      <TableCell className="font-mono">{c.phone}</TableCell>
                      <TableCell className="text-end font-mono">{c.invoices}</TableCell>
                      <TableCell className="text-end font-mono">{formatMoney(c.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function KpiBox({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="text-sm font-medium text-muted-foreground">{title}</div>
        <div className="text-2xl font-bold mt-1 tracking-tight">{value}</div>
      </CardContent>
    </Card>
  )
}

function SalesTable<T extends { invoices: number; total: number }>({
  rows,
  firstCol,
  keyFn
}: {
  rows: T[]
  firstCol: string
  keyFn: (r: T) => string
}) {
  const { t } = useTranslation()
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{firstCol}</TableHead>
          <TableHead className="text-end">{t('reports.invoiceCount')}</TableHead>
          <TableHead className="text-end">{t('reports.totalSales')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={keyFn(r)}>
            <TableCell className="font-mono">{keyFn(r)}</TableCell>
            <TableCell className="text-end font-mono">{r.invoices}</TableCell>
            <TableCell className="text-end font-mono">{formatMoney(r.total)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
