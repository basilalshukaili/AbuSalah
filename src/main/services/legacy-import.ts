/**
 * Imports the original AbuSalah.py text-file data:
 *   items/<product-name>             → "{code},{price},{qty}"
 *   bills/<phone>[.ext]              → multi-line:
 *     {NO}-{items_repr}-{total}-{advance}-{date}-{tax}-{name}-{comments}
 *
 * Uses a real Python-literal parser so item names with apostrophes are
 * preserved. Robust to:
 *   - file extensions on bill files (`.txt`, `.bak`)
 *   - duplicate product names (skipped quietly)
 *   - malformed individual lines (counted, the rest of the file continues)
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, basename, join } from 'node:path'
import { eq } from 'drizzle-orm'

import { db, rawClient } from '../db/connection'
import { customers, invoiceItems, invoices, products } from '../db/schema'
import { normalizePhone, roundMoney } from '@shared/formatting'
import { parsePyLiteral, PyParseError } from './python-literal'

function readTextRobust(path: string): string {
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return ''
  }
}

function parseDate(input: string): string | null {
  const s = (input ?? '').trim()
  if (!s) return null
  const m = s.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})$/)
  if (m) {
    let [, dd, mm, yyyy] = m
    if (yyyy.length === 2) yyyy = '20' + yyyy
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd))
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

interface ParsedBill {
  number: number
  items: Array<[string, string, number, number, number]> // [code, name, qty, unitPrice, lineTotal]
  total: number
  advance: number
  date: string | null
  tax: number
  name: string
  comments: string
}

/**
 * Bracket-aware parser for `{NO}-{[[...]]}-{total}-{advance}-{date}-{tax}-{name}-{comments}`.
 * Item literal is parsed with a real Python literal parser so apostrophes and
 * embedded commas in names are handled.
 */
export function parseLegacyBillLine(line: string): ParsedBill | null {
  const raw = line.replace(/\r?\n$/, '')
  if (!raw.trim()) return null
  const openIdx = raw.indexOf('[')
  if (openIdx === -1) return null

  // Find matching `]` respecting Python-style strings (single OR double quotes).
  let depth = 0
  let i = openIdx
  let inString: string | null = null
  let closeIdx = -1
  while (i < raw.length) {
    const ch = raw[i]
    if (inString !== null) {
      if (ch === '\\' && i + 1 < raw.length) {
        i += 2
        continue
      }
      if (ch === inString) inString = null
    } else if (ch === '"' || ch === "'") {
      inString = ch
    } else if (ch === '[') {
      depth++
    } else if (ch === ']') {
      depth--
      if (depth === 0) {
        closeIdx = i
        break
      }
    }
    i++
  }
  if (closeIdx === -1) return null

  const prefix = raw.slice(0, openIdx)
  const itemsRepr = raw.slice(openIdx, closeIdx + 1)
  let suffix = raw.slice(closeIdx + 1)
  if (!prefix.endsWith('-') || !suffix.startsWith('-')) return null
  const noStr = prefix.slice(0, -1)
  suffix = suffix.slice(1)
  const suffixParts = suffix.split('-')
  while (suffixParts.length < 6) suffixParts.push('')
  const [totalS, advanceS, dateS, taxS, nameS, ...rest] = suffixParts
  const comments = rest.join('-').trim()

  let parsedItems: unknown
  try {
    parsedItems = parsePyLiteral(itemsRepr)
  } catch (err) {
    if (err instanceof PyParseError) return null
    throw err
  }
  const items: ParsedBill['items'] = []
  if (Array.isArray(parsedItems)) {
    for (const row of parsedItems) {
      if (!Array.isArray(row) || row.length < 5) continue
      const code = String(row[0])
      const name = String(row[1])
      const qty = typeof row[2] === 'number' ? row[2] : Number(row[2])
      const unit = typeof row[3] === 'number' ? row[3] : Number(row[3])
      const lt = typeof row[4] === 'number' ? row[4] : Number(row[4])
      items.push([code, name, qty, unit, Number.isFinite(lt) ? lt : roundMoney(unit * qty)])
    }
  }

  const number = Number(noStr)
  if (!Number.isFinite(number)) return null

  return {
    number,
    items,
    total: Number(totalS) || 0,
    advance: Number(advanceS) || 0,
    date: parseDate(dateS),
    tax: Number(taxS) || 0,
    name: nameS.trim(),
    comments
  }
}

export interface ImportSummary {
  products: number
  invoices: number
  customers: number
  skippedProducts: number
  unparsedLines: number
}

function safeIsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/**
 * Strip extension (`.txt`, `.bak`, etc.) from a bill filename so the
 * remaining string is just the phone number.
 */
function billKeyFromFilename(filename: string): string {
  const ext = extname(filename)
  return ext ? basename(filename, ext) : filename
}

export async function importProducts(itemsDir: string): Promise<{ products: number; skipped: number }> {
  if (!safeIsDir(itemsDir)) return { products: 0, skipped: 0 }
  const c = rawClient()
  const existingNames = new Set(
    (await db().select({ name: products.name }).from(products).all()).map((r) => r.name)
  )

  let added = 0
  let skipped = 0
  // One transaction per file is overkill, but one per batch keeps memory bounded
  const tx = await c.transaction('write')
  try {
    for (const name of readdirSync(itemsDir)) {
      const full = join(itemsDir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (!st.isFile()) continue
      if (existingNames.has(name)) {
        skipped++
        continue
      }
      const content = readTextRobust(full).trim()
      if (!content) {
        skipped++
        continue
      }
      const parts = content.split(',').map((p) => p.trim())
      const code = parts[0] ?? ''
      const price = Number(parts[1]) || 0
      const qty = Number(parts[2]) || 0
      try {
        await tx.execute({
          sql: `INSERT INTO products (code, name, name_ar, price, qty)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(name) DO NOTHING`,
          args: [code, name, name, price, qty]
        })
        existingNames.add(name)
        added++
      } catch {
        skipped++
      }
    }
    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
  return { products: added, skipped }
}

export async function importBills(billsDir: string): Promise<{
  invoices: number
  customers: number
  unparsedLines: number
}> {
  if (!safeIsDir(billsDir)) return { invoices: 0, customers: 0, unparsedLines: 0 }
  const c = rawClient()

  const existingNumbers = new Set(
    (await db().select({ n: invoices.number }).from(invoices).all()).map((r) => Number(r.n))
  )
  const productMap = new Map<string, number>()
  for (const p of await db().select({ id: products.id, name: products.name }).from(products).all()) {
    productMap.set(p.name, p.id)
  }

  let importedInvoices = 0
  let importedCustomers = 0
  let unparsed = 0

  for (const filename of readdirSync(billsDir)) {
    const full = join(billsDir, filename)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (!st.isFile()) continue

    const phone = normalizePhone(billKeyFromFilename(filename))
    if (!phone) continue

    let custRow = await db().select().from(customers).where(eq(customers.phone, phone)).get()
    if (!custRow) {
      const inserted = await db().insert(customers).values({ phone, name: '' }).returning().get()
      if (!inserted) continue
      custRow = inserted
      importedCustomers++
    }

    const content = readTextRobust(full)
    // One transaction per bill file — bounded memory, isolation
    const tx = await c.transaction('write')
    try {
      for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) continue
        const parsed = parseLegacyBillLine(line)
        if (!parsed) {
          unparsed++
          continue
        }
        if (existingNumbers.has(parsed.number)) continue

        if (custRow.name === '' && parsed.name) {
          await tx.execute({
            sql: 'UPDATE customers SET name=? WHERE id=?',
            args: [parsed.name, custRow.id]
          })
          custRow = { ...custRow, name: parsed.name }
        }

        const subtotal = roundMoney(parsed.total - parsed.tax)
        const taxRate = subtotal > 0 ? Math.round((parsed.tax / subtotal) * 10000) / 10000 : 0.05
        const balance = roundMoney(parsed.total - parsed.advance)
        const status =
          parsed.advance <= 0
            ? 'unpaid'
            : parsed.advance + 1e-6 >= parsed.total
              ? 'paid'
              : 'partial'

        const ins = await tx.execute({
          sql: `INSERT INTO invoices
            (number, customer_id, date, subtotal, discount, tax_rate, tax_amount, total,
             advance, balance, payment_method, status, notes)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            RETURNING id`,
          args: [
            parsed.number,
            custRow.id,
            parsed.date ?? new Date().toISOString(),
            subtotal,
            0,
            taxRate,
            parsed.tax,
            parsed.total,
            parsed.advance,
            balance,
            'cash',
            status,
            parsed.comments ?? ''
          ]
        })
        const invoiceId = Number(ins.rows[0]?.id)
        existingNumbers.add(parsed.number)

        for (const it of parsed.items) {
          const [code, name, qty, unitPrice, lt] = it
          await tx.execute({
            sql: `INSERT INTO invoice_items
              (invoice_id, product_id, code, name_snapshot, qty, unit_price, line_total)
              VALUES (?,?,?,?,?,?,?)`,
            args: [invoiceId, productMap.get(name) ?? null, code, name, qty, unitPrice, lt]
          })
        }
        importedInvoices++
      }
      await tx.commit()
    } catch (err) {
      await tx.rollback()
      // Continue with next bill file rather than aborting the whole import
      console.warn(`failed to import bill file ${filename}:`, err)
    }
  }

  return { invoices: importedInvoices, customers: importedCustomers, unparsedLines: unparsed }
}

export async function importAll(opts: { itemsDir: string; billsDir: string }): Promise<ImportSummary> {
  const p = await importProducts(opts.itemsDir)
  const b = await importBills(opts.billsDir)
  return {
    products: p.products,
    invoices: b.invoices,
    customers: b.customers,
    skippedProducts: p.skipped,
    unparsedLines: b.unparsedLines
  }
}
