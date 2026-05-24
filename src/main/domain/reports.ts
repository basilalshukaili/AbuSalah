import { and, between, desc, eq, ne, sql } from 'drizzle-orm'

import type {
  KPISummary,
  SalesByDay,
  SalesByMonth,
  TopCustomer,
  TopProduct
} from '@shared/types'
import { db } from '../db/connection'
import { customers, invoiceItems, invoices } from '../db/schema'

function defaultRange(start?: string, end?: string): { start: string; end: string } {
  const today = new Date()
  const startD = start ?? new Date(today.getTime() - 30 * 86400_000).toISOString().slice(0, 10)
  const endD = end ?? today.toISOString().slice(0, 10)
  return {
    start: startD.length === 10 ? `${startD}T00:00:00.000Z` : startD,
    end: endD.length === 10 ? `${endD}T23:59:59.999Z` : endD
  }
}

export async function kpis(range: { start?: string; end?: string }): Promise<KPISummary> {
  const r = defaultRange(range?.start, range?.end)
  const row = await db()
    .select({
      count: sql<number>`COUNT(*)`,
      total: sql<number>`COALESCE(SUM(${invoices.total}), 0)`,
      advance: sql<number>`COALESCE(SUM(${invoices.advance}), 0)`,
      balance: sql<number>`COALESCE(SUM(${invoices.balance}), 0)`,
      tax: sql<number>`COALESCE(SUM(${invoices.taxAmount}), 0)`
    })
    .from(invoices)
    .where(and(between(invoices.date, r.start, r.end), ne(invoices.status, 'void')))
    .get()
  return {
    invoiceCount: Number(row?.count ?? 0),
    totalSales: Number(row?.total ?? 0),
    totalAdvance: Number(row?.advance ?? 0),
    totalBalance: Number(row?.balance ?? 0),
    totalTax: Number(row?.tax ?? 0),
    start: r.start,
    end: r.end
  }
}

export async function salesByDay(range: { start?: string; end?: string }): Promise<SalesByDay[]> {
  const r = defaultRange(range?.start, range?.end)
  const rows = await db()
    .select({
      day: sql<string>`substr(${invoices.date}, 1, 10)`,
      invoices: sql<number>`COUNT(*)`,
      total: sql<number>`COALESCE(SUM(${invoices.total}), 0)`
    })
    .from(invoices)
    .where(and(between(invoices.date, r.start, r.end), ne(invoices.status, 'void')))
    .groupBy(sql`substr(${invoices.date}, 1, 10)`)
    .orderBy(sql`substr(${invoices.date}, 1, 10)`)
    .all()
  return rows.map((r) => ({
    day: String(r.day),
    invoices: Number(r.invoices),
    total: Number(r.total)
  }))
}

export async function salesByMonth(range: {
  start?: string
  end?: string
}): Promise<SalesByMonth[]> {
  const r = defaultRange(range?.start, range?.end)
  const rows = await db()
    .select({
      month: sql<string>`substr(${invoices.date}, 1, 7)`,
      invoices: sql<number>`COUNT(*)`,
      total: sql<number>`COALESCE(SUM(${invoices.total}), 0)`
    })
    .from(invoices)
    .where(and(between(invoices.date, r.start, r.end), ne(invoices.status, 'void')))
    .groupBy(sql`substr(${invoices.date}, 1, 7)`)
    .orderBy(sql`substr(${invoices.date}, 1, 7)`)
    .all()
  return rows.map((r) => ({
    month: String(r.month),
    invoices: Number(r.invoices),
    total: Number(r.total)
  }))
}

export async function topProducts(
  range: { start?: string; end?: string },
  limit = 10
): Promise<TopProduct[]> {
  const r = defaultRange(range?.start, range?.end)
  const rows = await db()
    .select({
      name: invoiceItems.nameSnapshot,
      qty: sql<number>`COALESCE(SUM(${invoiceItems.qty}), 0)`,
      total: sql<number>`COALESCE(SUM(${invoiceItems.lineTotal}), 0)`
    })
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
    .where(and(between(invoices.date, r.start, r.end), ne(invoices.status, 'void')))
    .groupBy(invoiceItems.nameSnapshot)
    .orderBy(desc(sql`SUM(${invoiceItems.lineTotal})`))
    .limit(limit)
    .all()
  return rows.map((r) => ({
    name: String(r.name),
    qty: Number(r.qty),
    total: Number(r.total)
  }))
}

export async function topCustomers(
  range: { start?: string; end?: string },
  limit = 10
): Promise<TopCustomer[]> {
  const r = defaultRange(range?.start, range?.end)
  const rows = await db()
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      invoices: sql<number>`COUNT(${invoices.id})`,
      total: sql<number>`COALESCE(SUM(${invoices.total}), 0)`
    })
    .from(customers)
    .innerJoin(invoices, eq(invoices.customerId, customers.id))
    .where(and(between(invoices.date, r.start, r.end), ne(invoices.status, 'void')))
    .groupBy(customers.id, customers.name, customers.phone)
    .orderBy(desc(sql`SUM(${invoices.total})`))
    .limit(limit)
    .all()
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name ?? ''),
    phone: String(r.phone ?? ''),
    invoices: Number(r.invoices),
    total: Number(r.total)
  }))
}
