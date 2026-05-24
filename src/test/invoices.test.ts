import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq, and } from 'drizzle-orm'

import * as invoices from '@main/domain/invoices'
import * as products from '@main/domain/products'
import * as customers from '@main/domain/customers'
import { db } from '@main/db/connection'
import {
  inventoryMovements,
  invoiceItems as invoiceItemsTable,
  invoices as invoicesTable,
  products as productsTable
} from '@main/db/schema'

import { setupTestDb, teardownTestDb } from './setup'

const baseProductInput = {
  code: 'P1',
  name: 'Curtain raw',
  nameAr: 'ستائر خام',
  unit: 'm',
  price: 6.5,
  cost: 4,
  qty: 100,
  lowStockThreshold: 10,
  category: 'curtains',
  notes: ''
}

describe('domain/invoices', () => {
  let dbFile: string

  beforeEach(async () => {
    dbFile = await setupTestDb()
  })

  afterEach(() => {
    teardownTestDb(dbFile)
  })

  describe('create — totals and statuses', () => {
    it('computes subtotal/tax/total/balance for a multi-line invoice', async () => {
      const p1 = await products.create({ ...baseProductInput, name: 'Item A', qty: 100, price: 10 })
      const p2 = await products.create({ ...baseProductInput, name: 'Item B', qty: 50, price: 20 })

      const inv = await invoices.create({
        customerName: 'Hamad',
        customerPhone: '95500512',
        items: [
          { productId: p1.id, code: '', name: 'Item A', qty: 2, unitPrice: 10, extraPrice: 0 },
          { productId: p2.id, code: '', name: 'Item B', qty: 3, unitPrice: 20, extraPrice: 1 }
        ],
        discount: 5,
        advance: 0,
        taxRate: 0.05,
        paymentMethod: 'cash',
        notes: '',
        documentType: 'invoice'
      })

      // subtotal: (10+0)*2 + (20+1)*3 = 20 + 63 = 83
      expect(inv.subtotal).toBeCloseTo(83, 3)
      // taxable: 83 - 5 = 78; tax: 78 * 0.05 = 3.9
      expect(inv.taxAmount).toBeCloseTo(3.9, 3)
      // total: 78 + 3.9 = 81.9
      expect(inv.total).toBeCloseTo(81.9, 3)
      // balance = total - 0
      expect(inv.balance).toBeCloseTo(81.9, 3)
    })

    it('status = unpaid when advance is 0', async () => {
      const p = await products.create({ ...baseProductInput })
      const inv = await invoices.create({
        customerName: 'X',
        customerPhone: '95500512',
        items: [{ productId: p.id, code: '', name: p.name, qty: 1, unitPrice: 10, extraPrice: 0 }],
        discount: 0,
        advance: 0,
        taxRate: 0,
        paymentMethod: 'cash',
        notes: '',
        documentType: 'invoice'
      })
      expect(inv.status).toBe('unpaid')
      expect(inv.advance).toBe(0)
      expect(inv.balance).toBe(inv.total)
    })

    it('status = partial when 0 < advance < total', async () => {
      const p = await products.create({ ...baseProductInput })
      const inv = await invoices.create({
        customerName: 'X',
        customerPhone: '95500512',
        items: [{ productId: p.id, code: '', name: p.name, qty: 1, unitPrice: 10, extraPrice: 0 }],
        discount: 0,
        advance: 5,
        taxRate: 0,
        paymentMethod: 'cash',
        notes: '',
        documentType: 'invoice'
      })
      expect(inv.status).toBe('partial')
      expect(inv.advance).toBe(5)
      expect(inv.balance).toBeCloseTo(5, 3)
    })

    it('status = paid when advance >= total', async () => {
      const p = await products.create({ ...baseProductInput })
      const inv = await invoices.create({
        customerName: 'X',
        customerPhone: '95500512',
        items: [{ productId: p.id, code: '', name: p.name, qty: 1, unitPrice: 10, extraPrice: 0 }],
        discount: 0,
        advance: 10,
        taxRate: 0,
        paymentMethod: 'cash',
        notes: '',
        documentType: 'invoice'
      })
      expect(inv.status).toBe('paid')
      expect(inv.balance).toBeCloseTo(0, 3)
    })

    it('throws when items array is empty', async () => {
      await expect(
        invoices.create({
          customerName: '',
          customerPhone: '',
          items: [],
          discount: 0,
          advance: 0,
          taxRate: 0,
          paymentMethod: 'cash',
          notes: '',
          documentType: 'invoice'
        })
      ).rejects.toThrow(/at least one item/)
    })

    it('assigns next sequential invoice number', async () => {
      const p = await products.create({ ...baseProductInput })
      const a = await invoices.create({
        customerName: 'A',
        customerPhone: '95500511',
        items: [{ productId: p.id, code: '', name: p.name, qty: 1, unitPrice: 10, extraPrice: 0 }],
        discount: 0,
        advance: 0,
        taxRate: 0,
        paymentMethod: 'cash',
        notes: '',
        documentType: 'invoice'
      })
      const b = await invoices.create({
        customerName: 'B',
        customerPhone: '95500512',
        items: [{ productId: p.id, code: '', name: p.name, qty: 1, unitPrice: 10, extraPrice: 0 }],
        discount: 0,
        advance: 0,
        taxRate: 0,
        paymentMethod: 'cash',
        notes: '',
        documentType: 'invoice'
      })
      expect(b.number).toBe(a.number + 1)
    })
  })

  describe('create — stock movement', () => {
    it('decrements stock for each item with productId, and writes a sale movement', async () => {
      const p = await products.create({ ...baseProductInput, qty: 100 })
      const inv = await invoices.create({
        customerName: 'X',
        customerPhone: '95500512',
        items: [{ productId: p.id, code: 'P1', name: p.name, qty: 5, unitPrice: 6.5, extraPrice: 0 }],
        discount: 0,
        advance: 0,
        taxRate: 0,
        paymentMethod: 'cash',
        notes: '',
        documentType: 'invoice'
      })

      const after = await products.getById(p.id)
      expect(after?.qty).toBe(95)

      const moves = await db()
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.invoiceId, inv.id))
        .all()
      expect(moves.length).toBe(1)
      expect(moves[0].kind).toBe('sale')
      expect(moves[0].qtyDelta).toBe(-5)
      expect(moves[0].productId).toBe(p.id)
    })

    it('does not decrement stock when documentType=quotation', async () => {
      const p = await products.create({ ...baseProductInput, qty: 100 })
      await invoices.create({
        customerName: 'X',
        customerPhone: '95500512',
        items: [{ productId: p.id, code: 'P1', name: p.name, qty: 5, unitPrice: 6.5, extraPrice: 0 }],
        discount: 0,
        advance: 0,
        taxRate: 0,
        paymentMethod: 'cash',
        notes: '',
        documentType: 'quotation'
      })
      const after = await products.getById(p.id)
      expect(after?.qty).toBe(100)

      const moves = await db().select().from(inventoryMovements).all()
      expect(moves.length).toBe(0)
    })

    it('looks up productId by name when not provided', async () => {
      const p = await products.create({ ...baseProductInput, qty: 100 })
      const inv = await invoices.create({
        customerName: 'X',
        customerPhone: '95500512',
        items: [
          // productId: null but name matches
          { productId: null, code: '', name: p.name, qty: 3, unitPrice: 6.5, extraPrice: 0 }
        ],
        discount: 0,
        advance: 0,
        taxRate: 0,
        paymentMethod: 'cash',
        notes: '',
        documentType: 'invoice'
      })
      const after = await products.getById(p.id)
      expect(after?.qty).toBe(97)

      const item = inv.items[0]
      expect(item.productId).toBe(p.id)
    })

    it('skips stock decrement for items with no productId match', async () => {
      const inv = await invoices.create({
        customerName: 'X',
        customerPhone: '95500512',
        items: [
          { productId: null, code: '', name: 'unknown service', qty: 1, unitPrice: 50, extraPrice: 0 }
        ],
        discount: 0,
        advance: 0,
        taxRate: 0,
        paymentMethod: 'cash',
        notes: '',
        documentType: 'invoice'
      })
      const moves = await db().select().from(inventoryMovements).all()
      expect(moves.length).toBe(0)
      expect(inv.items[0].productId).toBeNull()
    })
  })

  describe('create — Arabic round-trip', () => {
    it('round-trips Arabic customer name and notes exactly', async () => {
      const arabicName = 'حمد البوسعيدي'
      const arabicNotes = 'بدون التوصيل'

      const p = await products.create({ ...baseProductInput })
      const inv = await invoices.create({
        customerName: arabicName,
        customerPhone: '95500512',
        items: [{ productId: p.id, code: 'P1', name: p.name, qty: 1, unitPrice: 6.5, extraPrice: 0 }],
        discount: 0,
        advance: 0,
        taxRate: 0,
        paymentMethod: 'cash',
        notes: arabicNotes,
        documentType: 'invoice'
      })

      expect(inv.customerName).toBe(arabicName)
      expect(inv.notes).toBe(arabicNotes)

      // Read back via getById
      const fresh = await invoices.getById(inv.id)
      expect(fresh?.customerName).toBe(arabicName)
      expect(fresh?.notes).toBe(arabicNotes)
    })
  })

  describe('getById / getByNumber', () => {
    it('returns full DTO including items', async () => {
      const p = await products.create({ ...baseProductInput })
      const created = await invoices.create({
        customerName: 'X',
        customerPhone: '95500512',
        items: [{ productId: p.id, code: 'P1', name: p.name, qty: 2, unitPrice: 5, extraPrice: 0 }],
        discount: 0,
        advance: 0,
        taxRate: 0,
        paymentMethod: 'cash',
        notes: '',
        documentType: 'invoice'
      })
      const got = await invoices.getById(created.id)
      expect(got).not.toBeNull()
      expect(got?.items.length).toBe(1)
      expect(got?.items[0].lineTotal).toBeCloseTo(10, 3)
    })

    it('getById returns null for missing id', async () => {
      expect(await invoices.getById(99999)).toBeNull()
    })

    it('getByNumber finds by number', async () => {
      const p = await products.create({ ...baseProductInput })
      const created = await invoices.create({
        customerName: 'X',
        customerPhone: '95500512',
        items: [{ productId: p.id, code: 'P1', name: p.name, qty: 1, unitPrice: 5, extraPrice: 0 }],
        discount: 0,
        advance: 0,
        taxRate: 0,
        paymentMethod: 'cash',
        notes: '',
        documentType: 'invoice'
      })
      const got = await invoices.getByNumber(created.number)
      expect(got?.id).toBe(created.id)
    })
  })

  describe('search', () => {
    let invA: Awaited<ReturnType<typeof invoices.create>>
    let invB: Awaited<ReturnType<typeof invoices.create>>

    beforeEach(async () => {
      const p = await products.create({ ...baseProductInput })

      invA = await invoices.create({
        customerName: 'Hamad',
        customerPhone: '95500512',
        items: [{ productId: p.id, code: 'P1', name: p.name, qty: 1, unitPrice: 10, extraPrice: 0 }],
        discount: 0,
        advance: 0,
        taxRate: 0,
        paymentMethod: 'cash',
        notes: 'something',
        documentType: 'invoice'
      })
      invB = await invoices.create({
        customerName: 'Ali',
        customerPhone: '99999999',
        items: [{ productId: p.id, code: 'P1', name: p.name, qty: 1, unitPrice: 20, extraPrice: 0 }],
        discount: 0,
        advance: 0,
        taxRate: 0,
        paymentMethod: 'cash',
        notes: 'urgent',
        documentType: 'invoice'
      })
    })

    it('returns all invoices (most recent first) when no filter', async () => {
      const r = await invoices.search({})
      expect(r.length).toBe(2)
    })

    it('matches by customer name', async () => {
      const r = await invoices.search({ term: 'Hamad' })
      expect(r.length).toBe(1)
      expect(r[0].id).toBe(invA.id)
    })

    it('matches by phone', async () => {
      const r = await invoices.search({ term: '99999' })
      expect(r.length).toBe(1)
      expect(r[0].id).toBe(invB.id)
    })

    it('matches by invoice number', async () => {
      const r = await invoices.search({ term: String(invA.number) })
      expect(r.length).toBeGreaterThanOrEqual(1)
      expect(r.some((i) => i.id === invA.id)).toBe(true)
    })

    it('matches by note text', async () => {
      const r = await invoices.search({ term: 'urgent' })
      expect(r.length).toBe(1)
      expect(r[0].id).toBe(invB.id)
    })

    it('filters by status', async () => {
      const r = await invoices.search({ status: 'unpaid' })
      expect(r.length).toBe(2)
    })

    it('filters by date range — out-of-range returns nothing', async () => {
      const r = await invoices.search({
        dateFrom: '1999-01-01T00:00:00.000Z',
        dateTo: '1999-12-31T23:59:59.999Z'
      })
      expect(r.length).toBe(0)
    })

    it('filters by date range — covers both invoices today', async () => {
      const today = new Date().toISOString().slice(0, 10)
      const r = await invoices.search({
        dateFrom: `${today}T00:00:00.000Z`,
        dateTo: `${today}T23:59:59.999Z`
      })
      expect(r.length).toBe(2)
    })
  })

  describe('voidInvoice', () => {
    it('marks status as void and restores stock', async () => {
      const p = await products.create({ ...baseProductInput, qty: 100 })
      const inv = await invoices.create({
        customerName: 'X',
        customerPhone: '95500512',
        items: [{ productId: p.id, code: 'P1', name: p.name, qty: 5, unitPrice: 6.5, extraPrice: 0 }],
        discount: 0,
        advance: 0,
        taxRate: 0,
        paymentMethod: 'cash',
        notes: '',
        documentType: 'invoice'
      })

      // sanity
      expect((await products.getById(p.id))?.qty).toBe(95)

      const v = await invoices.voidInvoice(inv.id, 'wrong customer')
      expect(v.status).toBe('void')
      expect(v.voidedAt).not.toBeNull()
      expect(v.voidedReason).toBe('wrong customer')

      // stock back to original
      const after = await products.getById(p.id)
      expect(after?.qty).toBe(100)

      // void_reversal movement created
      const moves = await db()
        .select()
        .from(inventoryMovements)
        .where(
          and(eq(inventoryMovements.invoiceId, inv.id), eq(inventoryMovements.kind, 'void_reversal'))
        )
        .all()
      expect(moves.length).toBe(1)
      expect(moves[0].qtyDelta).toBe(5)
    })

    it('throws on missing invoice', async () => {
      await expect(invoices.voidInvoice(99999, 'oops')).rejects.toThrow(/not found/)
    })

    it('voiding an already-voided invoice is a no-op', async () => {
      const p = await products.create({ ...baseProductInput, qty: 100 })
      const inv = await invoices.create({
        customerName: 'X',
        customerPhone: '95500512',
        items: [{ productId: p.id, code: 'P1', name: p.name, qty: 5, unitPrice: 6.5, extraPrice: 0 }],
        discount: 0,
        advance: 0,
        taxRate: 0,
        paymentMethod: 'cash',
        notes: '',
        documentType: 'invoice'
      })
      await invoices.voidInvoice(inv.id, 'first')
      // Stock should still be 100 after a second void call (no double-restore)
      await invoices.voidInvoice(inv.id, 'second')
      const after = await products.getById(p.id)
      expect(after?.qty).toBe(100)
    })
  })

  describe('recordPayment', () => {
    it('adds to advance, recomputes balance, updates status', async () => {
      const p = await products.create({ ...baseProductInput })
      const inv = await invoices.create({
        customerName: 'X',
        customerPhone: '95500512',
        items: [{ productId: p.id, code: 'P1', name: p.name, qty: 1, unitPrice: 100, extraPrice: 0 }],
        discount: 0,
        advance: 0,
        taxRate: 0,
        paymentMethod: 'cash',
        notes: '',
        documentType: 'invoice'
      })
      expect(inv.status).toBe('unpaid')
      expect(inv.balance).toBeCloseTo(100, 3)

      const partial = await invoices.recordPayment(inv.id, 30)
      expect(partial.advance).toBeCloseTo(30, 3)
      expect(partial.balance).toBeCloseTo(70, 3)
      expect(partial.status).toBe('partial')

      const paid = await invoices.recordPayment(inv.id, 70)
      expect(paid.advance).toBeCloseTo(100, 3)
      expect(paid.balance).toBeCloseTo(0, 3)
      expect(paid.status).toBe('paid')
    })

    it('throws when invoice not found', async () => {
      await expect(invoices.recordPayment(99999, 10)).rejects.toThrow(/not found/)
    })

    it('throws when invoice is already void', async () => {
      const p = await products.create({ ...baseProductInput })
      const inv = await invoices.create({
        customerName: 'X',
        customerPhone: '95500512',
        items: [{ productId: p.id, code: 'P1', name: p.name, qty: 1, unitPrice: 50, extraPrice: 0 }],
        discount: 0,
        advance: 0,
        taxRate: 0,
        paymentMethod: 'cash',
        notes: '',
        documentType: 'invoice'
      })
      await invoices.voidInvoice(inv.id, 'cancel')
      await expect(invoices.recordPayment(inv.id, 10)).rejects.toThrow(/voided/)
    })
  })

  describe('integration: customer is upserted', () => {
    it('creates a customer record when phone is supplied', async () => {
      const p = await products.create({ ...baseProductInput })
      const inv = await invoices.create({
        customerName: 'New Customer',
        customerPhone: '95500512',
        items: [{ productId: p.id, code: 'P1', name: p.name, qty: 1, unitPrice: 5, extraPrice: 0 }],
        discount: 0,
        advance: 0,
        taxRate: 0,
        paymentMethod: 'cash',
        notes: '',
        documentType: 'invoice'
      })
      expect(inv.customerId).not.toBeNull()
      expect(inv.customerName).toBe('New Customer')
      expect(inv.customerPhone).toBe('95500512')

      const c = await customers.findByPhone('95500512')
      expect(c).not.toBeNull()
      expect(c?.id).toBe(inv.customerId)
    })

    it('does NOT create a customer when phone is empty', async () => {
      const p = await products.create({ ...baseProductInput })
      const inv = await invoices.create({
        customerName: '',
        customerPhone: '',
        items: [{ productId: p.id, code: 'P1', name: p.name, qty: 1, unitPrice: 5, extraPrice: 0 }],
        discount: 0,
        advance: 0,
        taxRate: 0,
        paymentMethod: 'cash',
        notes: '',
        documentType: 'invoice'
      })
      expect(inv.customerId).toBeNull()
    })
  })
})
