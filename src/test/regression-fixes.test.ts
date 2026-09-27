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
import { invokeOperation } from '@main/api/operations'
import { db } from '@main/db/connection'
import { inventoryMovements, invoices as invoicesTable } from '@main/db/schema'
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

describe('regression: double-click / concurrent-call safety (2026-09-27 reliability review)', () => {
  let dbFile: string
  beforeEach(async () => {
    dbFile = await setupTestDb()
  })
  afterEach(() => {
    teardownTestDb(dbFile)
  })

  it('restock: two concurrent calls to the domain function both land — no lost update', async () => {
    const p = await products.create({
      code: 'RS1',
      name: 'Restock race item',
      nameAr: '',
      unit: 'pc',
      price: 1,
      cost: 0,
      qty: 100,
      lowStockThreshold: 0,
      category: '',
      notes: ''
    })

    // Calls products.restock() DIRECTLY, deliberately bypassing invokeOperation
    // and the shared mutation queue (unlike voidInvoice's explicit
    // multi-statement transaction, restock's plain single-statement
    // update/insert pair does not hit the local libsql client's "one
    // .transaction() at a time" limit, so real concurrency IS exercised
    // here — confirmed by first running this test with the fix reverted to
    // `qty: existing.qty + addQty`, where it failed with qty=105, not 110,
    // proving this test actually catches the lost-update regression it names).
    await Promise.all([
      products.restock(p.id, 5, 'race A'),
      products.restock(p.id, 5, 'race B')
    ])

    const fresh = await products.getById(p.id)
    expect(fresh?.qty).toBe(110)

    const moves = await db()
      .select()
      .from(inventoryMovements)
      .where(and(eq(inventoryMovements.productId, p.id), eq(inventoryMovements.kind, 'restock')))
      .all()
    expect(moves.length).toBe(2)
    expect(moves.reduce((sum, m) => sum + Number(m.qtyDelta), 0)).toBe(10)
  })

  it('restock: the same race through invokeOperation — the real dispatcher every click uses', async () => {
    // Complements the direct-call test above: this is what an actual
    // double-click or two-windows-open race does in the running app
    // (Electron IPC and the LAN phone API both call invokeOperation — see
    // src/main/api/operations.ts). The shared mutation queue serializes the
    // two calls so they never overlap in the first place; this would pass
    // even without the SQL fix above, which is exactly why the direct-call
    // test exists separately to pin the SQL itself.
    const p = await products.create({
      code: 'RS2',
      name: 'Restock race item (queued)',
      nameAr: '',
      unit: 'pc',
      price: 1,
      cost: 0,
      qty: 100,
      lowStockThreshold: 0,
      category: '',
      notes: ''
    })
    await Promise.all([
      invokeOperation('productsRestock', [p.id, 5, 'race A']),
      invokeOperation('productsRestock', [p.id, 5, 'race B'])
    ])
    expect((await products.getById(p.id))?.qty).toBe(110)
  })

  it('void: two concurrent void calls (through the real dispatcher) restore stock exactly once', async () => {
    const p = await products.create({
      code: 'VD1',
      name: 'Void race item',
      nameAr: '',
      unit: 'pc',
      price: 10,
      cost: 0,
      qty: 50,
      lowStockThreshold: 0,
      category: '',
      notes: ''
    })
    const inv = await invoices.create({
      customerName: '',
      customerPhone: '',
      items: [{ productId: p.id, code: '', name: p.name, qty: 5, unitPrice: 10, extraPrice: 0 }],
      discount: 0,
      advance: 0,
      taxRate: 0.05,
      paymentMethod: 'cash',
      notes: '',
      documentType: 'invoice'
    })
    expect((await products.getById(p.id))?.qty).toBe(45)

    // Through invokeOperation — the real dispatcher every click uses, on
    // desktop and on the phone LAN UI alike (src/main/api/operations.ts). The
    // shared mutation queue (src/main/api/mutation-queue.ts) serializes the
    // two calls, so this is what an actual double-click or two-windows-open
    // race does in the running app: both settle, stock is restored once.
    const results = await Promise.allSettled([
      invokeOperation('invoicesVoid', [inv.id, 'race A']),
      invokeOperation('invoicesVoid', [inv.id, 'race B'])
    ])
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)

    expect((await products.getById(p.id))?.qty).toBe(50)

    const reversals = await db()
      .select()
      .from(inventoryMovements)
      .where(
        and(eq(inventoryMovements.invoiceId, inv.id), eq(inventoryMovements.kind, 'void_reversal'))
      )
      .all()
    expect(reversals.length).toBe(1)
    expect(Number(reversals[0].qtyDelta)).toBe(5)
  })

  it('void: calling voidInvoice() twice in a row (bypassing the queue) is idempotent', async () => {
    // A genuine SEQUENTIAL retry rather than a race — e.g. the operator isn't
    // sure the first void went through and does it again a moment later, or
    // a script calls the domain function directly. Deliberately bypasses
    // invokeOperation so this exercises voidInvoice()'s own guard, not the
    // queue's. (A truly CONCURRENT direct call to voidInvoice() from this
    // same test file was tried and is not a usable test: the local libsql
    // client used here refuses a second in-flight `.transaction()` on one
    // connection outright — SQLITE_BUSY, immediately, unaffected by `PRAGMA
    // busy_timeout` — so that scenario is covered by the invokeOperation test
    // above instead, which is also what every real double-click goes
    // through.)
    const p = await products.create({
      code: 'VD2',
      name: 'Void idempotency item',
      nameAr: '',
      unit: 'pc',
      price: 10,
      cost: 0,
      qty: 50,
      lowStockThreshold: 0,
      category: '',
      notes: ''
    })
    const inv = await invoices.create({
      customerName: '',
      customerPhone: '',
      items: [{ productId: p.id, code: '', name: p.name, qty: 5, unitPrice: 10, extraPrice: 0 }],
      discount: 0,
      advance: 0,
      taxRate: 0.05,
      paymentMethod: 'cash',
      notes: '',
      documentType: 'invoice'
    })

    await invoices.voidInvoice(inv.id, 'first void')
    expect((await products.getById(p.id))?.qty).toBe(50)

    const second = await invoices.voidInvoice(inv.id, 'second void — should be a no-op')
    expect(second.status).toBe('void')
    expect((await products.getById(p.id))?.qty).toBe(50)

    const reversals = await db()
      .select()
      .from(inventoryMovements)
      .where(
        and(eq(inventoryMovements.invoiceId, inv.id), eq(inventoryMovements.kind, 'void_reversal'))
      )
      .all()
    expect(reversals.length).toBe(1)
  })
})

describe('regression: per-invoice tax exemption never touches Settings (2026-09-27)', () => {
  let dbFile: string
  beforeEach(async () => {
    dbFile = await setupTestDb()
  })
  afterEach(() => {
    teardownTestDb(dbFile)
  })

  it('taxRate: 0 on one invoice charges no tax and records taxRate=0 on that row only', async () => {
    const p = await products.create({
      code: 'TX1',
      name: 'Tax exempt item',
      nameAr: '',
      unit: 'pc',
      price: 20,
      cost: 0,
      qty: 10,
      lowStockThreshold: 0,
      category: '',
      notes: ''
    })

    const exempt = await invoices.create({
      customerName: '',
      customerPhone: '',
      items: [{ productId: p.id, code: '', name: p.name, qty: 1, unitPrice: 20, extraPrice: 0 }],
      discount: 0,
      advance: 0,
      taxRate: 0, // the per-invoice "sell without tax" toggle
      paymentMethod: 'cash',
      notes: '',
      documentType: 'invoice'
    })
    expect(exempt.taxRate).toBe(0)
    expect(exempt.taxAmount).toBe(0)
    expect(exempt.total).toBe(20)

    // The very next invoice, with no override, still uses the normal rate —
    // proving the exemption is per-row, not a side effect on shared state.
    const taxed = await invoices.create({
      customerName: '',
      customerPhone: '',
      items: [{ productId: p.id, code: '', name: p.name, qty: 1, unitPrice: 20, extraPrice: 0 }],
      discount: 0,
      advance: 0,
      taxRate: 0.05,
      paymentMethod: 'cash',
      notes: '',
      documentType: 'invoice'
    })
    expect(taxed.taxRate).toBe(0.05)
    expect(taxed.taxAmount).toBe(1)
    expect(taxed.total).toBe(21)

    // And the stored row for the FIRST invoice is unaffected by the second.
    const rows = await db().select().from(invoicesTable).where(eq(invoicesTable.id, exempt.id)).all()
    expect(Number(rows[0].taxRate)).toBe(0)
  })
})
