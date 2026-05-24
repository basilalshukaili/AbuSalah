import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, PackagePlus, Trash2, Search } from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { formatMoney } from '@shared/formatting'
import type { Product, ProductInput } from '@shared/types'

interface FormState extends ProductInput {
  id?: number
}

const empty: FormState = {
  code: '',
  name: '',
  nameAr: '',
  unit: 'm',
  price: 0,
  cost: 0,
  qty: 0,
  lowStockThreshold: 10,
  category: '',
  notes: ''
}

export function Products() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [term, setTerm] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [editing, setEditing] = useState<FormState | null>(null)
  const [restocking, setRestocking] = useState<Product | null>(null)
  const [restockQty, setRestockQty] = useState('0')
  const [confirmDelete, setConfirmDelete] = useState<Product | null>(null)

  const { data: products, refetch } = useQuery({
    queryKey: ['products', 'list', term, lowOnly],
    queryFn: () => window.api.productsList({ term, lowStockOnly: lowOnly })
  })

  async function save() {
    if (!editing) return
    try {
      const { id, ...input } = editing
      if (id !== undefined) {
        await window.api.productsUpdate(id, input)
        toast.success(t('msg.productUpdated'))
      } else {
        await window.api.productsCreate(input)
        toast.success(t('msg.productAdded'))
      }
      setEditing(null)
      qc.invalidateQueries({ queryKey: ['products'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  async function restockNow() {
    if (!restocking) return
    try {
      await window.api.productsRestock(restocking.id, Number(restockQty), 'manual restock')
      setRestocking(null)
      setRestockQty('0')
      qc.invalidateQueries({ queryKey: ['products'] })
      toast.success(t('common.success'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  async function disableProduct() {
    if (!confirmDelete) return
    try {
      await window.api.productsDelete(confirmDelete.id)
      setConfirmDelete(null)
      qc.invalidateQueries({ queryKey: ['products'] })
      toast.success(t('msg.productDisabled'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('products.title')}</h1>
          <p className="text-muted-foreground mt-1">{t('products.subtitle')}</p>
        </div>
        <Button size="lg" onClick={() => setEditing({ ...empty })}>
          <Plus className="h-4 w-4" />
          {t('products.addProduct')}
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          <div className="relative flex-1">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={t('products.title')}
              className="ps-10"
              onKeyDown={(e) => e.key === 'Enter' && refetch()}
            />
          </div>
          <label className="inline-flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={lowOnly}
              onChange={(e) => setLowOnly(e.target.checked)}
              className="h-4 w-4"
            />
            {t('products.lowOnly')}
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {products && products.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('products.code')}</TableHead>
                  <TableHead>{t('products.name')}</TableHead>
                  <TableHead>{t('products.nameAr')}</TableHead>
                  <TableHead className="text-end">{t('products.price')}</TableHead>
                  <TableHead className="text-end">{t('products.qty')}</TableHead>
                  <TableHead className="text-end">{t('products.lowThreshold')}</TableHead>
                  <TableHead className="text-end">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => {
                  const low = p.qty <= p.lowStockThreshold
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono">{p.code}</TableCell>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>{p.nameAr}</TableCell>
                      <TableCell className="text-end font-mono">
                        {formatMoney(p.price)}
                      </TableCell>
                      <TableCell
                        className={`text-end font-mono ${low ? 'text-destructive font-semibold' : ''}`}
                      >
                        {p.qty}
                      </TableCell>
                      <TableCell className="text-end font-mono">{p.lowStockThreshold}</TableCell>
                      <TableCell className="text-end">
                        <div className="flex gap-1 justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setEditing({
                                id: p.id,
                                code: p.code,
                                name: p.name,
                                nameAr: p.nameAr,
                                unit: p.unit,
                                price: p.price,
                                cost: p.cost,
                                qty: p.qty,
                                lowStockThreshold: p.lowStockThreshold,
                                category: p.category,
                                notes: p.notes
                              })
                            }
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setRestocking(p)
                              setRestockQty('0')
                            }}
                          >
                            <PackagePlus className="h-4 w-4 text-success" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmDelete(p)}
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
            <div className="p-10 text-center text-muted-foreground">{t('products.noResults')}</div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? t('products.updateProduct') : t('products.addProduct')}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>{t('products.code')}</Label>
                <Input
                  value={editing.code}
                  onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                />
              </div>
              <div>
                <Label>{t('products.unit')}</Label>
                <Input
                  value={editing.unit}
                  onChange={(e) => setEditing({ ...editing, unit: e.target.value })}
                />
              </div>
              <div>
                <Label>{t('products.name')}</Label>
                <Input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </div>
              <div>
                <Label>{t('products.nameAr')}</Label>
                <Input
                  dir="rtl"
                  value={editing.nameAr}
                  onChange={(e) => setEditing({ ...editing, nameAr: e.target.value })}
                />
              </div>
              <div>
                <Label>{t('products.price')}</Label>
                <Input
                  inputMode="decimal"
                  value={String(editing.price)}
                  onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>{t('products.qty')}</Label>
                <Input
                  inputMode="decimal"
                  value={String(editing.qty)}
                  onChange={(e) => setEditing({ ...editing, qty: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>{t('products.lowThreshold')}</Label>
                <Input
                  inputMode="decimal"
                  value={String(editing.lowStockThreshold)}
                  onChange={(e) =>
                    setEditing({ ...editing, lowStockThreshold: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label>{t('products.category')}</Label>
                <Input
                  value={editing.category}
                  onChange={(e) => setEditing({ ...editing, category: e.target.value })}
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

      <Dialog open={!!restocking} onOpenChange={(o) => !o && setRestocking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('products.restock')}</DialogTitle>
            <DialogDescription>
              {restocking?.nameAr || restocking?.name} — {t('products.qty')}: {restocking?.qty}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>{t('invoice.qty')}</Label>
            <Input
              inputMode="decimal"
              value={restockQty}
              onChange={(e) => setRestockQty(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestocking(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="success" onClick={restockNow}>
              {t('products.restock')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('common.confirm')}</DialogTitle>
            <DialogDescription>{t('products.deleteConfirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={disableProduct}>
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
