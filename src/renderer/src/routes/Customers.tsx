import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Search } from 'lucide-react'
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription
} from '@/components/ui/dialog'
import { formatMoney, hasArabic } from '@shared/formatting'
import type { Customer, CustomerInput } from '@shared/types'

interface FormState extends CustomerInput {
  id?: number
  outstanding?: number
}

const empty: FormState = { name: '', nameEn: '', phone: '', address: '', email: '', notes: '' }

export function Customers() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [term, setTerm] = useState('')
  const [editing, setEditing] = useState<FormState | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Customer | null>(null)

  const { data: customers, refetch } = useQuery({
    queryKey: ['customers', term],
    queryFn: () => window.api.customersList(term)
  })

  // Outstanding balance per customer (parallel queries)
  const { data: balances } = useQuery({
    queryKey: ['customers', 'balances', customers?.map((c) => c.id).join(',')],
    enabled: Boolean(customers),
    queryFn: async () => {
      if (!customers) return {}
      const entries = await Promise.all(
        customers.map(async (c) => [c.id, await window.api.customerOutstanding(c.id)] as const)
      )
      return Object.fromEntries(entries) as Record<number, number>
    }
  })

  async function save() {
    if (!editing) return
    try {
      if (editing.id !== undefined) {
        const { id, outstanding, ...rest } = editing
        await window.api.customersUpdate(id, rest)
      } else {
        await window.api.customersUpsert(editing)
      }
      setEditing(null)
      qc.invalidateQueries({ queryKey: ['customers'] })
      toast.success(t('msg.customerSaved'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  async function deleteCustomer() {
    if (!confirmDelete) return
    try {
      await window.api.customersDelete(confirmDelete.id)
      setConfirmDelete(null)
      qc.invalidateQueries({ queryKey: ['customers'] })
      toast.success(t('msg.customerDeleted'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('customers.title')}</h1>
          <p className="text-muted-foreground mt-1">{t('customers.subtitle')}</p>
        </div>
        <Button size="lg" onClick={() => setEditing({ ...empty })}>
          <Plus className="h-4 w-4" />
          {t('customers.addCustomer')}
        </Button>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={t('common.search')}
              className="ps-10"
              onKeyDown={(e) => e.key === 'Enter' && refetch()}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {customers && customers.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('customers.name')}</TableHead>
                  <TableHead>{t('customers.phone')}</TableHead>
                  <TableHead>{t('customers.address')}</TableHead>
                  <TableHead className="text-end">{t('customers.balance')}</TableHead>
                  <TableHead className="text-end">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c) => {
                  const out = balances?.[c.id] ?? 0
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium" dir="auto">{c.name || c.nameEn || '—'}</TableCell>
                      <TableCell className="font-mono">{c.phone}</TableCell>
                      <TableCell className="text-muted-foreground">{c.address}</TableCell>
                      <TableCell
                        className={`text-end font-mono ${out > 0 ? 'text-destructive font-semibold' : ''}`}
                      >
                        {formatMoney(out)}
                      </TableCell>
                      <TableCell className="text-end">
                        <div className="flex gap-1 justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setEditing({
                                id: c.id,
                                name: c.name,
                                nameEn: c.nameEn,
                                phone: c.phone,
                                address: c.address,
                                email: c.email,
                                notes: c.notes
                              })
                            }
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmDelete(c)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="p-10 text-center text-muted-foreground">
              {t('search.noResults')}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? t('customers.updateCustomer') : t('customers.addCustomer')}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>{t('customers.name')}</Label>
                <Input
                  dir="auto"
                  value={editing.name || editing.nameEn}
                  onChange={(e) => {
                    const v = e.target.value
                    const ar = hasArabic(v)
                    setEditing({ ...editing, name: ar ? v : '', nameEn: ar ? '' : v })
                  }}
                />
              </div>
              <div>
                <Label>{t('customers.phone')}</Label>
                <Input
                  value={editing.phone}
                  onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                  inputMode="tel"
                  dir="ltr"
                />
              </div>
              <div className="md:col-span-2">
                <Label>{t('customers.address')}</Label>
                <Input
                  value={editing.address}
                  onChange={(e) => setEditing({ ...editing, address: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <Label>{t('customers.notes')}</Label>
                <Input
                  value={editing.notes}
                  onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="success" onClick={save}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('common.confirm')}</DialogTitle>
            <DialogDescription>{t('customers.deleteConfirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={deleteCustomer}>
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
