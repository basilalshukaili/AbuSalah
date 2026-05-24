import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Printer, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog'
import { formatMoney } from '@shared/formatting'
import type { Invoice } from '@shared/types'

export function SearchInvoices() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [term, setTerm] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [opened, setOpened] = useState<Invoice | null>(null)
  const [confirmVoid, setConfirmVoid] = useState<Invoice | null>(null)

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['invoices', 'search', term, from, to],
    queryFn: () =>
      window.api.invoicesSearch({
        term,
        dateFrom: from ? `${from}T00:00:00.000Z` : undefined,
        dateTo: to ? `${to}T23:59:59.999Z` : undefined,
        limit: 500
      })
  })

  async function printInvoice(inv: Invoice) {
    try {
      await window.api.invoicePrint(inv.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  async function voidInvoice(inv: Invoice) {
    try {
      await window.api.invoicesVoid(inv.id, 'voided from search')
      toast.success(t('msg.invoiceVoided'))
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['products'] })
      setConfirmVoid(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">{t('search.title')}</h1>

      <Card>
        <CardContent className="p-6 grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-6">
            <Label htmlFor="term">{t('search.term')}</Label>
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="term"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder={t('search.term')}
                className="ps-10"
                onKeyDown={(e) => e.key === 'Enter' && refetch()}
              />
            </div>
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="from">{t('search.from')}</Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="to">{t('search.to')}</Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Button size="lg" className="w-full" onClick={() => refetch()} disabled={isFetching}>
              <Search className="h-4 w-4" />
              {t('common.search')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {data && data.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('invoice.number')}</TableHead>
                  <TableHead>{t('invoice.date')}</TableHead>
                  <TableHead>{t('customers.name')}</TableHead>
                  <TableHead>{t('customers.phone')}</TableHead>
                  <TableHead className="text-end">{t('invoice.total')}</TableHead>
                  <TableHead className="text-end">{t('invoice.balance')}</TableHead>
                  <TableHead>{t('invoice.status')}</TableHead>
                  <TableHead className="text-end">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">#{inv.number}</TableCell>
                    <TableCell>{(inv.date || '').slice(0, 10)}</TableCell>
                    <TableCell>{inv.customerName || '—'}</TableCell>
                    <TableCell className="font-mono">{inv.customerPhone || '—'}</TableCell>
                    <TableCell className="text-end font-mono">{formatMoney(inv.total)}</TableCell>
                    <TableCell
                      className={`text-end font-mono ${inv.balance > 0 ? 'text-destructive' : ''}`}
                    >
                      {formatMoney(inv.balance)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded
                          ${
                            inv.status === 'paid'
                              ? 'bg-success/10 text-success'
                              : inv.status === 'partial'
                                ? 'bg-amber-500/10 text-amber-600'
                                : inv.status === 'void'
                                  ? 'bg-muted text-muted-foreground line-through'
                                  : 'bg-destructive/10 text-destructive'
                          }`}
                      >
                        {inv.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex gap-1 justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setOpened(inv)}
                          aria-label="open"
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => printInvoice(inv)}
                          aria-label="print"
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmVoid(inv)}
                          aria-label="void"
                          disabled={inv.status === 'void'}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-10 text-center text-muted-foreground">{t('search.noResults')}</div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!opened} onOpenChange={(o) => !o && setOpened(null)}>
        <DialogContent className="max-w-2xl">
          {opened && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t('invoice.number')}: #{opened.number}
                </DialogTitle>
                <DialogDescription>
                  {(opened.date || '').slice(0, 10)} · {opened.customerName || '—'} ·{' '}
                  <span dir="ltr">{opened.customerPhone || '—'}</span>
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-96 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('invoice.product')}</TableHead>
                      <TableHead className="text-end">{t('invoice.qty')}</TableHead>
                      <TableHead className="text-end">{t('invoice.lineTotal')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {opened.items.map((it) => (
                      <TableRow key={it.id}>
                        <TableCell className="font-medium">{it.nameSnapshot}</TableCell>
                        <TableCell className="text-end font-mono">{it.qty}</TableCell>
                        <TableCell className="text-end font-mono">
                          {formatMoney(it.lineTotal)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {opened.notes && (
                  <p className="mt-4 text-sm bg-amber-500/10 border-s-4 border-amber-500 p-3 rounded">
                    <strong>{t('invoice.notes')}: </strong>
                    {opened.notes}
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button onClick={() => printInvoice(opened)}>
                  <Printer className="h-4 w-4" />
                  {t('common.print')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmVoid} onOpenChange={(o) => !o && setConfirmVoid(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('common.confirm')}</DialogTitle>
            <DialogDescription>{t('invoice.voidConfirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmVoid(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => confirmVoid && voidInvoice(confirmVoid)}>
              {t('invoice.void')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
