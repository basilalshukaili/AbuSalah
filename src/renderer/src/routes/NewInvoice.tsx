import { useState, useMemo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Printer, Save, Trash2, Search } from 'lucide-react'
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
import { useAppStore } from '@/stores/app-store'
import { formatMoney, roundMoney, hasArabic } from '@shared/formatting'
import type { Product, Customer } from '@shared/types'

interface Line {
  productId: number | null
  code: string
  name: string
  qty: number
  unitPrice: number
  extraPrice: number
  lineTotal: number
}

export function NewInvoice() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const settings = useAppStore((s) => s.settings)

  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [showCustDropdown, setShowCustDropdown] = useState(false)
  const [custHighlightedIdx, setCustHighlightedIdx] = useState(-1)
  const custDropdownRef = useRef<HTMLDivElement>(null)
  const [productTerm, setProductTerm] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [qty, setQty] = useState('1')
  const [extra, setExtra] = useState('0')
  const [discount, setDiscount] = useState('0')
  const [advance, setAdvance] = useState('0')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [busy, setBusy] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightedIdx, setHighlightedIdx] = useState(-1)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Always fetch all products; filter client-side on productTerm
  const { data: allProducts } = useQuery({
    queryKey: ['products', 'pick'],
    queryFn: () => window.api.productsList({ activeOnly: true })
  })

  // All customers for the searchable picker; filtered client-side
  const { data: allCustomers } = useQuery({
    queryKey: ['customers', 'pick'],
    queryFn: () => window.api.customersList()
  })

  const customerResults = useMemo(() => {
    if (!allCustomers) return []
    const raw = customerName.trim()
    if (!raw) return allCustomers.slice(0, 8)
    const q = raw.toLowerCase()
    return allCustomers
      .filter(
        (c) =>
          (c.name && c.name.toLowerCase().includes(q)) ||
          (c.nameEn && c.nameEn.toLowerCase().includes(q)) ||
          (c.phone && c.phone.includes(raw))
      )
      .slice(0, 8)
  }, [allCustomers, customerName])

  // Filter products by search term
  const searchResults = useMemo(() => {
    if (!allProducts) return []
    if (!productTerm.trim()) return allProducts.slice(0, 20)
    const q = productTerm.trim().toLowerCase()
    return allProducts
      .filter(
        (p) =>
          (p.nameAr && p.nameAr.includes(productTerm)) ||
          (p.name && p.name.toLowerCase().includes(q)) ||
          (p.code && p.code.toLowerCase().includes(q))
      )
      .slice(0, 20)
  }, [allProducts, productTerm])

  const totals = useMemo(() => {
    const taxRate = settings?.taxRate ?? 0.05
    const subtotal = roundMoney(lines.reduce((sum, l) => sum + l.lineTotal, 0))
    const d = Math.min(subtotal, Math.max(0, Number(discount) || 0))
    const taxable = Math.max(0, subtotal - d)
    const tax = roundMoney(taxable * taxRate)
    const total = roundMoney(taxable + tax)
    const adv = Math.max(0, Number(advance) || 0)
    const balance = roundMoney(total - adv)
    return { subtotal, discount: d, tax, total, balance, taxRate }
  }, [lines, discount, advance, settings])

  function pickProduct(p: Product) {
    setSelectedProduct(p)
    setProductTerm(p.nameAr || p.name)
    setShowDropdown(false)
    setHighlightedIdx(-1)
    setTimeout(() => {
      const el = document.getElementById('qty') as HTMLInputElement | null
      el?.focus()
      el?.select()
    }, 0)
  }

  function pickCustomer(c: Customer) {
    // Use the name written in the same script the user is typing in;
    // fall back to whichever name exists.
    const chosen = hasArabic(customerName) ? c.name || c.nameEn : c.nameEn || c.name
    setCustomerName(chosen)
    if (c.phone) setCustomerPhone(c.phone)
    setShowCustDropdown(false)
    setCustHighlightedIdx(-1)
    setTimeout(() => document.getElementById('product-term')?.focus(), 0)
  }

  function handleCustomerKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const open = showCustDropdown && customerResults.length > 0
    if (!open) {
      if (e.key === 'Enter') {
        e.preventDefault()
        document.getElementById('cphone')?.focus()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCustHighlightedIdx((i) => Math.min(i + 1, customerResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCustHighlightedIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (custHighlightedIdx >= 0 && customerResults[custHighlightedIdx]) {
        pickCustomer(customerResults[custHighlightedIdx])
      } else {
        document.getElementById('cphone')?.focus()
      }
    } else if (e.key === 'Escape') {
      setShowCustDropdown(false)
      setCustHighlightedIdx(-1)
    }
  }

  function addLine() {
    if (!selectedProduct) {
      toast.error(t('invoice.product') + ': ' + (productTerm || '?'))
      return
    }
    const q = Number(qty)
    if (!Number.isFinite(q) || q <= 0) {
      toast.error(t('invoice.qty'))
      return
    }
    const e = Math.max(0, Number(extra) || 0)
    const lineTotal = roundMoney((selectedProduct.price + e) * q)
    setLines([
      ...lines,
      {
        productId: selectedProduct.id,
        code: selectedProduct.code,
        name: selectedProduct.nameAr || selectedProduct.name,
        qty: q,
        unitPrice: selectedProduct.price,
        extraPrice: e,
        lineTotal
      }
    ])
    setSelectedProduct(null)
    setProductTerm('')
    setQty('1')
    setExtra('0')
    setTimeout(() => {
      const el = document.getElementById('product-term') as HTMLInputElement | null
      el?.focus()
    }, 0)
  }

  function removeLine(idx: number) {
    setLines(lines.filter((_, i) => i !== idx))
  }

  function clearForm() {
    setCustomerName('')
    setCustomerPhone('')
    setShowCustDropdown(false)
    setCustHighlightedIdx(-1)
    setProductTerm('')
    setSelectedProduct(null)
    setQty('1')
    setExtra('0')
    setDiscount('0')
    setAdvance('0')
    setNotes('')
    setLines([])
  }

  async function save(printAfter: boolean) {
    if (lines.length === 0) {
      toast.error(t('invoice.noItemsYet'))
      return
    }
    setBusy(true)
    try {
      const nm = customerName.trim()
      const nameIsArabic = hasArabic(nm)
      const inv = await window.api.invoicesCreate({
        customerName: nameIsArabic ? nm : '',
        customerNameEn: nameIsArabic ? '' : nm,
        customerPhone: customerPhone.trim(),
        items: lines.map((l) => ({
          productId: l.productId,
          code: l.code,
          name: l.name,
          qty: l.qty,
          unitPrice: l.unitPrice,
          extraPrice: l.extraPrice
        })),
        discount: totals.discount,
        advance: Number(advance) || 0,
        paymentMethod: 'cash',
        notes: notes.trim(),
        documentType: 'invoice'
      })
      toast.success(t('msg.invoiceSaved', { number: inv.number }))
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['kpis'] })
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['customers'] })
      if (printAfter) {
        await window.api.invoicePrint(inv.id)
      }
      clearForm()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault()
        void save(false)
      } else if (e.ctrlKey && e.key === 'p') {
        e.preventDefault()
        void save(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProduct, qty, extra, lines, customerName, customerPhone])

  // Scroll highlighted customer into view
  useEffect(() => {
    if (custHighlightedIdx < 0 || !custDropdownRef.current) return
    const item = custDropdownRef.current.children[custHighlightedIdx] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [custHighlightedIdx])

  // Handle arrow keys + Enter in product dropdown
  function handleProductKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showDropdown || searchResults.length === 0) {
      if (e.key === 'Enter' && selectedProduct) {
        e.preventDefault()
        addLine()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIdx((i) => Math.min(i + 1, searchResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlightedIdx >= 0 && searchResults[highlightedIdx]) {
        pickProduct(searchResults[highlightedIdx])
      } else if (selectedProduct) {
        addLine()
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false)
      setHighlightedIdx(-1)
    }
  }

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIdx < 0 || !dropdownRef.current) return
    const item = dropdownRef.current.children[highlightedIdx] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIdx])

  const isDropdownVisible = showDropdown && !selectedProduct && searchResults.length > 0

  return (
    <div className="space-y-4">
      {/* ── Title + keyboard hint strip ─────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-3xl font-bold tracking-tight">{t('invoice.newTitle')}</h1>
        <div className="flex gap-2 flex-wrap">
          <kbd className="inline-flex items-center gap-1 rounded border bg-muted px-2 py-1 text-xs font-mono text-muted-foreground">
            Ctrl+P → {t('invoice.saveAndPrint')}
          </kbd>
          <kbd className="inline-flex items-center gap-1 rounded border bg-muted px-2 py-1 text-xs font-mono text-muted-foreground">
            Ctrl+S → {t('invoice.saveOnly')}
          </kbd>
          <kbd className="inline-flex items-center gap-1 rounded border bg-muted px-2 py-1 text-xs font-mono text-muted-foreground">
            {t('invoice.navHint')}
          </kbd>
        </div>
      </div>

      {/* ── Customer info ────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">{t('invoice.customerInfo')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Searchable customer name (Arabic OR English) */}
            <div className="relative">
              <Label htmlFor="cname" className="text-base font-semibold">
                {t('invoice.name')}
              </Label>
              <div className="relative mt-1">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  id="cname"
                  dir="auto"
                  value={customerName}
                  onChange={(e) => {
                    setCustomerName(e.target.value)
                    setShowCustDropdown(true)
                    setCustHighlightedIdx(-1)
                  }}
                  onFocus={() => setShowCustDropdown(true)}
                  onBlur={() => setTimeout(() => setShowCustDropdown(false), 200)}
                  onKeyDown={handleCustomerKeyDown}
                  placeholder={t('invoice.customerSearchPlaceholder')}
                  className="ps-10 text-base"
                  autoComplete="off"
                />
              </div>
              {showCustDropdown && customerResults.length > 0 && (
                <div
                  ref={custDropdownRef}
                  className="absolute z-20 mt-1 max-h-72 overflow-auto w-full rounded-lg border bg-popover shadow-xl"
                >
                  {customerResults.map((c, idx) => (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={() => pickCustomer(c)}
                      className={`block w-full text-start px-4 py-2.5 text-sm border-b last:border-b-0 transition-colors
                        ${idx === custHighlightedIdx ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
                    >
                      <div className="flex justify-between items-center gap-2">
                        <span className="font-semibold text-base">{c.name || c.nameEn || '—'}</span>
                        <span
                          className={`font-mono text-sm ${idx === custHighlightedIdx ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}
                          dir="ltr"
                        >
                          {c.phone}
                        </span>
                      </div>
                      {c.name && c.nameEn && (
                        <div
                          className={`text-xs mt-0.5 ${idx === custHighlightedIdx ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}
                          dir="ltr"
                        >
                          {c.nameEn}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {t('invoice.customerSearchHint')}
              </p>
            </div>

            {/* Phone */}
            <div>
              <Label htmlFor="cphone" className="text-base font-semibold">
                {t('invoice.phone')}
              </Label>
              <Input
                id="cphone"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="9XXXXXXX"
                inputMode="tel"
                dir="ltr"
                className="text-base mt-1"
                onKeyDown={(e) =>
                  e.key === 'Enter' && document.getElementById('product-term')?.focus()
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Product picker ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">{t('invoice.product')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            {/* Search with dropdown */}
            <div className="md:col-span-6 relative">
              <Label htmlFor="product-term" className="text-base font-semibold">
                {t('invoice.searchProduct')}
              </Label>
              <div className="relative mt-1">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  id="product-term"
                  value={productTerm}
                  onChange={(e) => {
                    setProductTerm(e.target.value)
                    setSelectedProduct(null)
                    setHighlightedIdx(-1)
                    setShowDropdown(true)
                  }}
                  onFocus={() => setShowDropdown(true)}
                  onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                  onKeyDown={handleProductKeyDown}
                  placeholder={t('invoice.productSearchPlaceholder')}
                  className={`ps-10 text-base ${selectedProduct ? 'border-green-500 bg-green-50 dark:bg-green-950' : ''}`}
                  autoComplete="off"
                />
              </div>
              {/* Dropdown */}
              {isDropdownVisible && (
                <div
                  ref={dropdownRef}
                  className="absolute z-20 mt-1 max-h-80 overflow-auto w-full rounded-lg border bg-popover shadow-xl"
                >
                  {searchResults.map((p, idx) => (
                    <button
                      key={p.id}
                      type="button"
                      onMouseDown={() => pickProduct(p)}
                      className={`block w-full text-start px-4 py-3 text-sm border-b last:border-b-0 transition-colors
                        ${idx === highlightedIdx ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
                    >
                      <div className="flex justify-between items-center gap-2">
                        <span className="font-semibold text-base">{p.nameAr || p.name}</span>
                        <span className={`font-mono font-bold text-base ${idx === highlightedIdx ? 'text-primary-foreground' : 'text-primary'}`}>
                          {formatMoney(p.price)}
                        </span>
                      </div>
                      <div className={`text-xs mt-0.5 ${idx === highlightedIdx ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                        {p.name && p.nameAr ? p.name + ' · ' : ''}
                        {p.code ? `#${p.code} · ` : ''}
                        {t('products.qty')}: {p.qty}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {/* Hint below field */}
              <p className="text-xs text-muted-foreground mt-1">
                {selectedProduct
                  ? `✓ ${t('invoice.selected')}: ${selectedProduct.nameAr || selectedProduct.name}`
                  : t('invoice.productPickHint')}
              </p>
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="qty" className="text-base font-semibold">
                {t('invoice.qty')}
              </Label>
              <Input
                id="qty"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                inputMode="decimal"
                className="text-base mt-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (selectedProduct) addLine()
                    else document.getElementById('product-term')?.focus()
                  }
                }}
              />
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="extra" className="text-base font-semibold">
                {t('invoice.extraPrice')}
              </Label>
              <Input
                id="extra"
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                inputMode="decimal"
                className="text-base mt-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (selectedProduct) addLine()
                  }
                }}
              />
            </div>

            <div className="md:col-span-2">
              <Button
                type="button"
                size="lg"
                className="w-full text-base h-12 mt-6"
                onClick={addLine}
                disabled={!selectedProduct}
              >
                <Plus className="h-5 w-5" />
                {t('invoice.addItem')}
                <kbd className="ms-2 hidden md:inline text-xs opacity-70 border border-current rounded px-1">Enter</kbd>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Line items ───────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-0">
          {lines.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground text-lg">
              {t('invoice.noItemsYet')}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>{t('products.code')}</TableHead>
                  <TableHead>{t('invoice.product')}</TableHead>
                  <TableHead className="text-end">{t('invoice.qty')}</TableHead>
                  <TableHead className="text-end">{t('invoice.unitPrice')}</TableHead>
                  <TableHead className="text-end">{t('invoice.extraPrice')}</TableHead>
                  <TableHead className="text-end text-primary font-bold">{t('invoice.lineTotal')}</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l, i) => (
                  <TableRow key={i} className={i % 2 === 0 ? 'bg-muted/30' : ''}>
                    <TableCell className="font-bold text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-mono text-xs">{l.code}</TableCell>
                    <TableCell className="font-semibold text-base">{l.name}</TableCell>
                    <TableCell className="text-end font-mono">{l.qty}</TableCell>
                    <TableCell className="text-end font-mono">{formatMoney(l.unitPrice)}</TableCell>
                    <TableCell className="text-end font-mono">{formatMoney(l.extraPrice)}</TableCell>
                    <TableCell className="text-end font-mono font-bold text-base text-primary">
                      {formatMoney(l.lineTotal)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeLine(i)}
                        aria-label="remove"
                        className="h-9 w-9"
                      >
                        <Trash2 className="h-5 w-5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Totals + notes ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-2">
          <CardContent className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="discount" className="text-base font-semibold">
                {t('invoice.discount')} (OMR)
              </Label>
              <Input
                id="discount"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                inputMode="decimal"
                className="text-base mt-1"
              />
            </div>
            <div>
              <Label htmlFor="advance" className="text-base font-semibold">
                {t('invoice.advance')} (OMR)
              </Label>
              <Input
                id="advance"
                value={advance}
                onChange={(e) => setAdvance(e.target.value)}
                inputMode="decimal"
                className="text-base mt-1"
              />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="notes" className="text-base font-semibold">
                {t('invoice.notes')}
              </Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="text-base mt-1"
              />
            </div>
          </CardContent>
        </Card>

        {/* Summary */}
        <Card className="border-2 border-primary/20">
          <CardContent className="p-6 space-y-3">
            <div className="flex justify-between text-base">
              <span className="text-muted-foreground">{t('invoice.subtotal')}</span>
              <span className="font-mono font-semibold">{formatMoney(totals.subtotal)}</span>
            </div>
            {totals.discount > 0 && (
              <div className="flex justify-between text-base">
                <span className="text-muted-foreground">{t('invoice.discount')}</span>
                <span className="font-mono text-destructive">-{formatMoney(totals.discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-base">
              <span className="text-muted-foreground">
                {t('invoice.tax')} ({(totals.taxRate * 100).toFixed(1)}%)
              </span>
              <span className="font-mono">{formatMoney(totals.tax)}</span>
            </div>
            <div className="flex justify-between text-2xl font-bold pt-2 border-t-2">
              <span>{t('invoice.total')}</span>
              <span className="font-mono text-primary">{formatMoney(totals.total)}</span>
            </div>
            <div className="flex justify-between text-lg font-semibold">
              <span className="text-muted-foreground">{t('invoice.balance')}</span>
              <span
                className={`font-mono ${totals.balance > 0 ? 'text-destructive' : 'text-success'}`}
              >
                {formatMoney(totals.balance)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Action buttons ───────────────────────────────────────────── */}
      <div className="flex flex-col-reverse md:flex-row gap-3 justify-between items-center">
        <Button variant="outline" size="lg" onClick={clearForm} className="h-14 text-base px-6">
          🆕 {t('invoice.nextCustomer')}
        </Button>
        <div className="flex gap-3">
          <Button
            variant="success"
            size="lg"
            onClick={() => save(false)}
            disabled={busy || lines.length === 0}
            className="h-14 text-base px-6"
          >
            <Save className="h-5 w-5" />
            {t('invoice.saveOnly')}
            <kbd className="ms-2 hidden md:inline text-xs opacity-70 border border-current rounded px-1.5 py-0.5">Ctrl+S</kbd>
          </Button>
          <Button
            size="lg"
            onClick={() => save(true)}
            disabled={busy || lines.length === 0}
            className="h-14 text-base px-6"
          >
            <Printer className="h-5 w-5" />
            {t('invoice.saveAndPrint')}
            <kbd className="ms-2 hidden md:inline text-xs opacity-70 border border-current rounded px-1.5 py-0.5">Ctrl+P</kbd>
          </Button>
        </div>
      </div>
    </div>
  )
}
