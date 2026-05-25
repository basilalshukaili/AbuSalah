/**
 * Regression tests for the data-safety / correctness fixes from the
 * comprehensive audit:
 *  - safeNumber guards NaN/Infinity/junk at the DB boundary
 *  - product create coerces non-finite numeric input to a finite fallback
 *  - invoice totals stay finite even with a bad line price
 *  - stock is decremented/restored correctly when the SAME product appears on
 *    multiple lines of one invoice (create = relative update; void = relative)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { and, eq } from 'drizzle-orm'

import * as invoices from '@main/domain/invoices'
import * as products from '@main/domain/products'
import { db } from '@main/db/connection'
import { inventoryMovements } from '@main/db/schema'
import { safeNumber } from '@shared/formatting'

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

describe('safeNumber', () => {
  it('passes finite numbers through unchanged', () => {
    expect(safeNumber(5)).toBe(5)
    expect(safeNumber(-3.25)).toBe(-3.25)
    expect(safeNumber(0)).toBe(0)
  })
  it('parses numeric strings', () => {
    expect(safeNumber('12.5')).toBe(12.5)
  })
  it('falls back to 0 for NaN / Infinity / junk / nullish', () => {
    expect(safeNumber(Number.NaN)).toBe(0)
    expect(safeNumber(Number.POSITIVE_INFINITY)).toBe(0)
    expect(safeNumber('abc')).toBe(0)
    expect(safeNumber(undefined)).toBe(0)
    expect(safeNumber(null)).toBe(0)
    expect(safeNumber({})).toBe(0)
  })
  it('uses a custom fallback', () => {
    expect(safeNumber('nope', 10)).toBe(10)
  })
})

describe('regression: non-finite input never reaches the DB as NaN', () => {
  let dbFile: string
  beforeEach(async () => {
    dbFile = await setupTestDb()
  })
  afterEach(() => {
    teardownTestDb(dbFile)
  })

  it('products.create coerces a non-finite price/qty to a finite fallback', async () => {
    const p = await products.create({
      ...baseProductInput,
      name: 'NaN guard',
      price: Number.NaN as unknown as number,
      qty: 'abc' as unknown as number
    })
    expect(Number.isFinite(p.price)).toBe(true)
    expect(p.price).toBe(0)
    expect(Number.isFinite(p.qty)).toBe(true)
    expect(p.qty).toBe(0)
  })

  it('invoice totals stay finite when a line price is non-finite', async () => {
    const p = await products.create({ ...baseProductInput, name: 'Item X', qty: 100, price: 10 })
    const inv = await invoices.create({
      customerName: '',
      customerPhone: '',
      items: [
        {
          productId: p.id,
          code: '',
          name: 'Item X',
          qty: 2,
          unitPrice: Number.NaN as unknown as number,
          extraPrice: 0
        }
      ],
      discount: 0,
      advance: 0,
      taxRate: 0.05,
      paymentMethod: 'cash',
      notes: '',
      documentType: 'invoice'
    })
    expect(Number.isNaN(inv.subtotal)).toBe(false)
    expect(Number.isNaN(inv.total)).toBe(false)
    expect(Number.isFinite(inv.total)).toBe(true)
  })
})

describe('regression: duplicate product lines decrement & restore stock correctly', () => {
  let dbFile: string
  beforeEach(async () => {
    dbFile = await setupTestDb()
  })
  afterEach(() => {
    teardownTestDb(dbFile)
  })

  it('create decrements the same product once per line (no lost update)', async () => {
    const p = await products.create({ ...baseProductInput, name: 'Dup product', qty: 100 })
    const inv = await invoices.create({
      customerName: '',
      customerPhone: '',
      items: [
        { productId: p.id, code: '', name: p.name, qty: 3, unitPrice: 6.5, extraPrice: 0 },
        { productId: p.id, code: '', name: p.name, qty: 4, unitPrice: 6.5, extraPrice: 0 }
      ],
      discount: 0,
      advance: 0,
      taxRate: 0.05,
      paymentMethod: 'cash',
      notes: '',
      documentType: 'invoice'
    })
    // 100 − 3 − 4 = 93 (an absolute-update bug would leave 96)
    expect((await products.getById(p.id))?.qty).toBe(93)

    await invoices.voidInvoice(inv.id, 'duplicate-line regression')
    // every line restored → back to 100
    expect((await products.getById(p.id))?.qty).toBe(100)

    const moves = await db()
      .select()
      .from(inventoryMovements)
      .where(
        and(eq(inventoryMovements.invoiceId, inv.id), eq(inventoryMovements.kind, 'void_reversal'))
      )
      .all()
    expect(moves.length).toBe(2)
    expect(moves.reduce((sum, m) => sum + Number(m.qtyDelta), 0)).toBe(7)
  })
})
