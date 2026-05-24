import ExcelJS from 'exceljs'
import { and, between, eq, ne } from 'drizzle-orm'

import { db } from '../db/connection'
import { customers, invoiceItems, invoices } from '../db/schema'

interface Range {
  start?: string
  end?: string
}

function defaultRange(r?: Range): { start: string; end: string } {
  const today = new Date()
  const startD = r?.start ?? new Date(today.getTime() - 30 * 86400_000).toISOString().slice(0, 10)
  const endD = r?.end ?? today.toISOString().slice(0, 10)
  return {
    start: startD.length === 10 ? `${startD}T00:00:00.000Z` : startD,
    end: endD.length === 10 ? `${endD}T23:59:59.999Z` : endD
  }
}

export async function exportSalesExcel(range: Range, target: string): Promise<string> {
  const r = defaultRange(range)

  const rows = await db()
    .select()
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
    .leftJoin(customers, eq(customers.id, invoices.customerId))
    .where(and(between(invoices.date, r.start, r.end), ne(invoices.status, 'void')))
    .all()

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Abu Salah'
  wb.created = new Date()
  const ws = wb.addWorksheet('Sales')

  ws.columns = [
    { header: 'Invoice #', key: 'invoice_no', width: 12 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Customer', key: 'customer', width: 24 },
    { header: 'Phone', key: 'phone', width: 14 },
    { header: 'Item Code', key: 'code', width: 10 },
    { header: 'Item Name', key: 'item', width: 40 },
    { header: 'Qty', key: 'qty', width: 8 },
    { header: 'Unit Price', key: 'unit_price', width: 12 },
    { header: 'Line Total', key: 'line_total', width: 14 },
    { header: 'Tax', key: 'tax', width: 10 },
    { header: 'Total', key: 'total', width: 12 },
    { header: 'Status', key: 'status', width: 10 }
  ]

  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  ws.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0F172A' }
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  for (const r of rows as any[]) {
    ws.addRow({
      invoice_no: r.invoices.number,
      date: (r.invoices.date ?? '').slice(0, 10),
      customer: r.customers?.name ?? '',
      phone: r.customers?.phone ?? '',
      code: r.invoice_items.code ?? '',
      item: r.invoice_items.name_snapshot ?? r.invoice_items.nameSnapshot ?? '',
      qty: Number(r.invoice_items.qty),
      unit_price: Number(r.invoice_items.unit_price ?? r.invoice_items.unitPrice),
      line_total: Number(r.invoice_items.line_total ?? r.invoice_items.lineTotal),
      tax: Number(r.invoices.tax_amount ?? r.invoices.taxAmount),
      total: Number(r.invoices.total),
      status: r.invoices.status
    })
  }

  await wb.xlsx.writeFile(target)
  return target
}
