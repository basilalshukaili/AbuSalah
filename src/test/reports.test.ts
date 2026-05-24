import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'

import * as reports from '@main/domain/reports'
import * as products from '@main/domain/products'
import * as invoices from '@main/domain/invoices'
import { db } from '@main/db/connection'
import { invoices as invoicesTable } from '@main/db/schema'

import { setupTestDb, teardownTestDb } from './setup'

const baseProductInput = {
  code: 'P1',
  name: 'P',
  nameAr: '',
  unit: 'm',
  price: 10,
  cost: 5,
  qty: 100,
  lowStockThreshold: 10,
  category: '',
  notes: ''
}

/**
 * Build three invoices with controlled dates and statuses.
 *
 * - inv1 on day 1 (yesterday): total ~30
 * - inv2 on day 2 (today):     total ~70
 * - inv3 on day 1 (yesterday): total ~50, voided
 *
 * All in the same month so we can test salesByMonth aggregation.
 */
async function seedInvoices(): Promise<{
  day1: string
  day2: string
  invIdsByLabel: Record<'inv1' | 'inv2' | 'inv3', number>
  pA: number
  pB: number
}> {
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86_400_000)

  // ISO date with time
  const day1 = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 12, 0, 0).toISOString()
  const day2 = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0).toISOString()

  const pA = await products.create({
    ...baseProductInput,
    name: 'Product A',
    code: 'A',
    qty: 1000,
    price: 10
  })
  const pB = await products.create({
    ...baseProductInput,
    name: 'Product B',
    code: 'B',
    qty: 1000,
    price: 20
  })

  // inv1 — Hamad on day1 — Product A x 3 = 30
  const inv1 = await invoices.create({
    customerName: 'Hamad',
    customerPhone: '95500511',
    items: [{ productId: pA.id, code: 'A', name: 'Product A', qty: 3, unitPrice: 10, extraPrice: 0 }],
    discount: 0,
    advance: 0,
    taxRate: 0,
    paymentMethod: 'cash',
    notes: '',
    documentType: 'invoice'
  })
  // inv2 — Ali on day2 — Product B x 3 = 60 + Product A x 1 = 10 → 70
  const inv2 = await invoices.create({
    customerName: 'Ali',
    customerPhone: '95500522',
    items: [
      { productId: pB.id, code: 'B', name: 'Product B', qty: 3, unitPrice: 20, extraPrice: 0 },
      { productId: pA.id, code: 'A', name: 'Product A', qty: 1, unitPrice: 10, extraPrice: 0 }
    ],
    discount: 0,
    advance: 0,
    taxRate: 0,
    paymentMethod: 'cash',
    notes: '',
    documentType: 'invoice'
  })
  // inv3 — Hamad on day1 — Product A x 5 = 50 → will be voided
  const inv3 = await invoices.create({
    customerName: 'Hamad',
    customerPhone: '95500511',
    items: [{ productId: pA.id, code: 'A', name: 'Product A', qty: 5, unitPrice: 10, extraPrice: 0 }],
    discount: 0,
    advance: 0,
    taxRate: 0,
    paymentMethod: 'cash',
    notes: '',
    documentType: 'invoice'
  })

  // Force the dates by direct UPDATE so groupBy day/month is deterministic
  await db().update(invoicesTable).set({ date: day1 }).where(eq(invoicesTable.id, inv1.id)).run()
  await db().update(invoicesTable).set({ date: day2 }).where(eq(invoicesTable.id, inv2.id)).run()
  await db().update(invoicesTable).set({ date: day1 }).where(eq(invoicesTable.id, inv3.id)).run()

  // Void inv3
  await invoices.voidInvoice(inv3.id, 'mistake')

  return {
    day1,
    day2,
    invIdsByLabel: { inv1: inv1.id, inv2: inv2.id, inv3: inv3.id },
    pA: pA.id,
    pB: pB.id
  }
}

describe('domain/reports', () => {
  let dbFile: string

  beforeEach(async () => {
    dbFile = await setupTestDb()
  })

  afterEach(() => {
    teardownTestDb(dbFile)
  })

  it('kpis: counts only non-void invoices and sums their totals', async () => {
    const { day1, day2 } = await seedInvoices()
    const k = await reports.kpis({
      start: day1.slice(0, 10),
      end: day2.slice(0, 10)
    })

    expect(k.invoiceCount).toBe(2)
    expect(k.totalSales).toBeCloseTo(30 + 70, 3)
  })

  it('salesByDay: groups invoices into per-day rows, ordered ascending', async () => {
    const { day1, day2 } = await seedInvoices()
    const rows = await reports.salesByDay({
      start: day1.slice(0, 10),
      end: day2.slice(0, 10)
    })

    expect(rows.length).toBe(2)
    expect(rows[0].day).toBe(day1.slice(0, 10))
    expect(rows[1].day).toBe(day2.slice(0, 10))

    // ascending order
    expect(rows[0].day < rows[1].day).toBe(true)

    // day1 only has the non-void inv1 (30); inv3 is voided
    expect(rows[0].total).toBeCloseTo(30, 3)
    expect(rows[0].invoices).toBe(1)

    // day2 has inv2 (70)
    expect(rows[1].total).toBeCloseTo(70, 3)
    expect(rows[1].invoices).toBe(1)
  })

  it('salesByMonth: aggregates invoices by YYYY-MM', async () => {
    const { day1, day2 } = await seedInvoices()
    const rows = await reports.salesByMonth({
      start: day1.slice(0, 10),
      end: day2.slice(0, 10)
    })

    // Both day1 and day2 are within the test "now" so they're either same or
    // adjacent months.  Verify total across all rows = 100 (excluding void).
    const total = rows.reduce((s, r) => s + r.total, 0)
    const count = rows.reduce((s, r) => s + r.invoices, 0)
    expect(total).toBeCloseTo(100, 3)
    expect(count).toBe(2)

    // months are well-formed YYYY-MM
    rows.forEach((r) => expect(r.month).toMatch(/^\d{4}-\d{2}$/))
  })

  it('topProducts: ordered by sum(line_total) descending', async () => {
    const { day1, day2 } = await seedInvoices()
    const rows = await reports.topProducts({
      start: day1.slice(0, 10),
      end: day2.slice(0, 10)
    })

    // Product B: only inv2 → 60
    // Product A: inv1 (30) + inv2 part (10) = 40 (inv3 is voided so excluded)
    // Product B should be first
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows[0].name).toBe('Product B')
    expect(rows[0].total).toBeCloseTo(60, 3)
    expect(rows[1].name).toBe('Product A')
    expect(rows[1].total).toBeCloseTo(40, 3)
  })

  it('topCustomers: ordered by sum(total) desc; voided invoices excluded', async () => {
    const { day1, day2 } = await seedInvoices()
    const rows = await reports.topCustomers({
      start: day1.slice(0, 10),
      end: day2.slice(0, 10)
    })

    // Ali contributed 70 (single invoice)
    // Hamad contributed 30 (inv3=50 voided so excluded; inv1=30)
    expect(rows.length).toBe(2)
    expect(rows[0].name).toBe('Ali')
    expect(rows[0].total).toBeCloseTo(70, 3)
    expect(rows[0].invoices).toBe(1)

    expect(rows[1].name).toBe('Hamad')
    expect(rows[1].total).toBeCloseTo(30, 3)
    expect(rows[1].invoices).toBe(1)
  })

  it('topProducts respects the limit parameter', async () => {
    const { day1, day2 } = await seedInvoices()
    const rows = await reports.topProducts({ start: day1.slice(0, 10), end: day2.slice(0, 10) }, 1)
    expect(rows.length).toBe(1)
    expect(rows[0].name).toBe('Product B')
  })

  it('kpis returns 0 when no invoices in range', async () => {
    await seedInvoices()
    const k = await reports.kpis({
      start: '1999-01-01',
      end: '1999-12-31'
    })
    expect(k.invoiceCount).toBe(0)
    expect(k.totalSales).toBe(0)
  })
})
