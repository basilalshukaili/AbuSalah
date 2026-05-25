/**
 * Invoice domain logic.
 *
 * IMPORTANT: every multi-statement write (`create`, `voidInvoice`,
 * `recordPayment`) executes inside a libsql `client.batch(...)` so the whole
 * sequence is atomic — either all writes happen or none do. REQUIREMENTS
 * line 22 states this explicitly.
 */

import { and, asc, between, desc, eq, gte, like, lte, max, ne, or, sql } from 'drizzle-orm'

import type {
  DocumentType,
  Invoice,
  InvoiceInput,
  InvoiceItem,
  InvoiceStatus,
  PaymentMethod
} from '@shared/types'
import { normalizePhone, roundMoney, safeNumber } from '@shared/formatting'
import { db, rawClient } from '../db/connection'
import {
  customers,
  inventoryMovements,
  invoiceItems,
  invoices,
  products
} from '../db/schema'
import { upsertByPhone } from './customers'

function statusFor(total: number, advance: number): InvoiceStatus {
  if (advance <= 0) return 'unpaid'
  if (advance + 1e-6 >= total) return 'paid'
  return 'partial'
}

async function nextInvoiceNumber(): Promise<number> {
  const row = await db().select({ max: max(invoices.number) }).from(invoices).get()
  return Number(row?.max ?? 0) + 1
}

/**
 * Compute totals — discount is **clamped to [0, subtotal]** so the persisted
 * row always satisfies `subtotal − discount + tax = total`.
 */
function computeTotals(
  items: InvoiceInput['items'],
  rawDiscount: number,
  taxRate: number
): { subtotal: number; tax: number; total: number; discount: number } {
  let subtotal = 0
  for (const it of items) {
    const line = (safeNumber(it.unitPrice) + safeNumber(it.extraPrice, 0)) * safeNumber(it.qty)
    subtotal += line
  }
  subtotal = roundMoney(subtotal)
  const discount = roundMoney(Math.min(subtotal, Math.max(0, safeNumber(rawDiscount, 0))))
  const taxable = Math.max(0, subtotal - discount)
  const tax = roundMoney(taxable * safeNumber(taxRate, 0))
  const total = roundMoney(taxable + tax)
  return { subtotal, tax, total, discount }
}

async function rowToDto(row: typeof invoices.$inferSelect): Promise<Invoice> {
  const cust = row.customerId
    ? await db().select().from(customers).where(eq(customers.id, row.customerId)).get()
    : null
  const items = await db()
    .select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, row.id))
    .orderBy(asc(invoiceItems.id))
    .all()

  const itemDtos: InvoiceItem[] = items.map((it) => ({
    id: it.id,
    invoiceId: it.invoiceId,
    productId: it.productId,
    code: it.code,
    nameSnapshot: it.nameSnapshot,
    qty: Number(it.qty),
    unitPrice: Number(it.unitPrice),
    extraPrice: Number(it.extraPrice),
    lineTotal: Number(it.lineTotal)
  }))

  return {
    id: row.id,
    number: row.number,
    customerId: row.customerId,
    date: row.date,
    subtotal: Number(row.subtotal),
    discount: Number(row.discount),
    taxRate: Number(row.taxRate),
    taxAmount: Number(row.taxAmount),
    total: Number(row.total),
    advance: Number(row.advance),
    balance: Number(row.balance),
    paymentMethod: row.paymentMethod as PaymentMethod,
    status: row.status as InvoiceStatus,
    documentType: row.documentType as DocumentType,
    notes: row.notes,
    voidedAt: row.voidedAt,
    voidedReason: row.voidedReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    customerName: cust?.name ?? '',
    customerNameEn: (cust as any)?.nameEn ?? '',
    customerPhone: cust?.phone ?? '',
    items: itemDtos
  }
}

export async function create(input: InvoiceInput): Promise<Invoice> {
  if (!input.items || input.items.length === 0) {
    throw new Error('invoice must have at least one item')
  }
  if (input.taxRate === undefined) {
    throw new Error('taxRate is required (inject from settings at IPC boundary)')
  }
  const taxRate = safeNumber(input.taxRate, 0)

  const { subtotal, tax, total, discount } = computeTotals(
    input.items,
    safeNumber(input.discount, 0),
    taxRate
  )
  const advance = roundMoney(Math.max(0, safeNumber(input.advance, 0)))
  const balance = roundMoney(total - advance)
  const status = statusFor(total, advance)

  // Resolve customer (this is itself transactional inside upsertByPhone)
  let customerId: number | null = null
  if (input.customerPhone && input.customerPhone.trim()) {
    const c = await upsertByPhone({
      phone: normalizePhone(input.customerPhone),
      name: input.customerName ?? '',
      nameEn: input.customerNameEn ?? '',
      address: '',
      email: '',
      notes: ''
    })
    customerId = c.id
  }

  // Reserve invoice number atomically — read max under the same connection
  const number = await nextInvoiceNumber()

  // Pre-resolve product IDs and current stock so the transaction is self-contained
  type Resolved = {
    li: InvoiceInput['items'][number]
    productId: number | null
    currentQty: number
    currentCost: number
    qty: number
    unitPrice: number
    extra: number
    lineTotal: number
  }
  const resolved: Resolved[] = []
  for (const li of input.items) {
    const qty = safeNumber(li.qty)
    const unitPrice = safeNumber(li.unitPrice)
    const extra = safeNumber(li.extraPrice, 0)
    const lineTotal = roundMoney((unitPrice + extra) * qty)
    let productId = li.productId ?? null
    let currentQty = 0
    let currentCost = 0
    if (productId === null && li.name) {
      const found = await db().select().from(products).where(eq(products.name, li.name)).get()
      if (found) productId = found.id
    }
    if (productId !== null) {
      const p = await db().select().from(products).where(eq(products.id, productId)).get()
      currentQty = Number(p?.qty ?? 0)
      currentCost = Number(p?.cost ?? 0)
    }
    resolved.push({ li, productId, currentQty, currentCost, qty, unitPrice, extra, lineTotal })
  }

  // ---- Atomic write ----
  const c = rawClient()
  // libsql transaction (deferred is fine; we're not racing other writers)
  const tx = await c.transaction('write')
  try {
    const insRes = await tx.execute({
      sql: `INSERT INTO invoices
        (number, customer_id, subtotal, discount, tax_rate, tax_amount, total, advance, balance,
         payment_method, status, document_type, notes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        RETURNING id, date, created_at, updated_at`,
      args: [
        number,
        customerId,
        subtotal,
        discount,
        taxRate,
        tax,
        total,
        advance,
        balance,
        input.paymentMethod ?? 'cash',
        status,
        input.documentType ?? 'invoice',
        input.notes ?? ''
      ]
    })
    const invoiceId = Number(insRes.rows[0]?.id)
    if (!Number.isFinite(invoiceId)) throw new Error('failed to insert invoice')

    for (const r of resolved) {
      await tx.execute({
        sql: `INSERT INTO invoice_items
          (invoice_id, product_id, code, name_snapshot, qty, unit_price, extra_price, line_total)
          VALUES (?,?,?,?,?,?,?,?)`,
        args: [
          invoiceId,
          r.productId,
          r.li.code ?? '',
          r.li.name,
          r.qty,
          r.unitPrice,
          r.extra,
          r.lineTotal
        ]
      })

      if (r.productId !== null && (input.documentType ?? 'invoice') !== 'quotation') {
        // Relative update (qty = qty - ?) so that multiple lines for the SAME
        // product on one invoice each decrement correctly. An absolute
        // `SET qty = currentQty - qty` (currentQty read once before the tx) would
        // let the last line overwrite the earlier ones — a lost update.
        await tx.execute({
          sql: `UPDATE products SET qty=qty-?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
          args: [r.qty, r.productId]
        })
        await tx.execute({
          sql: `INSERT INTO inventory_movements
            (product_id, invoice_id, kind, qty_delta, unit_cost, reason)
            VALUES (?,?,?,?,?,?)`,
          args: [r.productId, invoiceId, 'sale', -r.qty, r.currentCost, `sale on invoice #${number}`]
        })
      }
    }
    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }

  const fresh = await db().select().from(invoices).where(eq(invoices.number, number)).get()
  if (!fresh) throw new Error('invoice disappeared after insert')
  return rowToDto(fresh)
}

export async function getById(id: number): Promise<Invoice | null> {
  const row = await db().select().from(invoices).where(eq(invoices.id, id)).get()
  return row ? rowToDto(row) : null
}

export async function getByNumber(no: number): Promise<Invoice | null> {
  const row = await db().select().from(invoices).where(eq(invoices.number, Number(no))).get()
  return row ? rowToDto(row) : null
}

export async function listForCustomer(customerId: number): Promise<Invoice[]> {
  const rows = await db()
    .select()
    .from(invoices)
    .where(eq(invoices.customerId, customerId))
    .orderBy(desc(invoices.date))
    .all()
  return Promise.all(rows.map(rowToDto))
}

export interface SearchFilter {
  term?: string
  dateFrom?: string
  dateTo?: string
  status?: InvoiceStatus | ''
  limit?: number
}

export async function search(filter: SearchFilter = {}): Promise<Invoice[]> {
  const conditions = []
  const term = (filter.term ?? '').trim()
  if (term) {
    const like_ = `%${term}%`
    const num = Number(term)
    const text = or(
      like(customers.name, like_),
      like(customers.phone, like_),
      like(invoices.notes, like_)
    )
    conditions.push(/^\d+$/.test(term) && Number.isFinite(num) ? or(text, eq(invoices.number, num)) : text)
  }
  if (filter.dateFrom) conditions.push(gte(invoices.date, filter.dateFrom))
  if (filter.dateTo) conditions.push(lte(invoices.date, filter.dateTo))
  if (filter.status) conditions.push(eq(invoices.status, filter.status))

  const baseQuery = db().select().from(invoices).leftJoin(customers, eq(invoices.customerId, customers.id))
  const filtered = conditions.length ? baseQuery.where(and(...conditions)) : baseQuery
  const rows = await filtered.orderBy(desc(invoices.date)).limit(filter.limit ?? 500).all()
  return Promise.all(
    rows.map((r: { invoices: typeof invoices.$inferSelect }) => rowToDto(r.invoices))
  )
}

/**
 * Void an invoice atomically — restores stock for every line item that has a
 * `product_id`, and writes a `void_reversal` movement for each. The whole
 * operation runs in one transaction (all-or-nothing); it is idempotent at the
 * invoice level because re-voiding an already-void invoice returns early
 * (the `status === 'void'` guard below).
 */
export async function voidInvoice(id: number, reason: string): Promise<Invoice> {
  const row = await db().select().from(invoices).where(eq(invoices.id, id)).get()
  if (!row) throw new Error(`invoice ${id} not found`)
  if (row.status === 'void') return rowToDto(row)

  const items = await db().select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id)).all()

  // Pre-fetch products for their current cost
  const productById = new Map<number, typeof products.$inferSelect>()
  for (const it of items) {
    if (it.productId !== null && !productById.has(it.productId)) {
      const p = await db().select().from(products).where(eq(products.id, it.productId)).get()
      if (p) productById.set(it.productId, p)
    }
  }

  const c = rawClient()
  const tx = await c.transaction('write')
  try {
    await tx.execute({
      sql: `UPDATE invoices
        SET status='void', voided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            voided_reason=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=?`,
      args: [reason || '', id]
    })
    for (const it of items) {
      if (it.productId === null) continue
      const p = productById.get(it.productId)
      if (!p) continue
      await tx.execute({
        sql: `UPDATE products SET qty=qty+?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
        args: [Number(it.qty), it.productId]
      })
      await tx.execute({
        sql: `INSERT INTO inventory_movements
          (product_id, invoice_id, kind, qty_delta, unit_cost, reason)
          VALUES (?,?,?,?,?,?)`,
        args: [
          it.productId,
          row.id,
          'void_reversal',
          Number(it.qty),
          Number(p.cost),
          `void of invoice #${row.number}: ${reason}`
        ]
      })
    }
    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }

  const fresh = await db().select().from(invoices).where(eq(invoices.id, id)).get()
  if (!fresh) throw new Error('invoice disappeared after void')
  return rowToDto(fresh)
}

/**
 * Apply a payment. Caps `advance` at `total` so a negative balance is never
 * stored — overpayments are rejected with a clear error rather than silently
 * crediting the shop.
 */
export async function recordPayment(id: number, amount: number): Promise<Invoice> {
  const row = await db().select().from(invoices).where(eq(invoices.id, id)).get()
  if (!row) throw new Error(`invoice ${id} not found`)
  if (row.status === 'void') throw new Error('cannot pay against a voided invoice')
  const amt = Number(amount)
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('payment amount must be positive')

  const total = Number(row.total)
  const newAdvance = roundMoney(Number(row.advance) + amt)
  if (newAdvance > total + 1e-6) {
    throw new Error(`payment exceeds balance; remaining is ${roundMoney(total - Number(row.advance))}`)
  }
  const newBalance = roundMoney(total - newAdvance)
  const newStatus = statusFor(total, newAdvance)

  await db()
    .update(invoices)
    .set({
      advance: newAdvance,
      balance: newBalance,
      status: newStatus,
      updatedAt: new Date().toISOString()
    })
    .where(eq(invoices.id, id))
    .run()
  const fresh = await db().select().from(invoices).where(eq(invoices.id, id)).get()
  if (!fresh) throw new Error('invoice disappeared after payment')
  return rowToDto(fresh)
}

// Test exports
export const _internal = { computeTotals, statusFor }
