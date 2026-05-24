/**
 * One-shot table & default-row creation for libsql. We don't need formal
 * migrations for v2 because we ship a single schema; just CREATE TABLE
 * IF NOT EXISTS and INSERT OR IGNORE the default settings.
 */

import { rawClient } from './connection'

const DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_unique ON customers(phone)`,

  `CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    name_ar TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT 'm',
    price REAL NOT NULL DEFAULT 0,
    cost REAL NOT NULL DEFAULT 0,
    qty REAL NOT NULL DEFAULT 0,
    low_stock_threshold REAL NOT NULL DEFAULT 10,
    category TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS products_name_unique ON products(name)`,

  `CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number INTEGER NOT NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    date TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    subtotal REAL NOT NULL DEFAULT 0,
    discount REAL NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 0.05,
    tax_amount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    advance REAL NOT NULL DEFAULT 0,
    balance REAL NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL DEFAULT 'cash',
    status TEXT NOT NULL DEFAULT 'unpaid',
    document_type TEXT NOT NULL DEFAULT 'invoice',
    notes TEXT NOT NULL DEFAULT '',
    voided_at TEXT,
    voided_reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS invoices_number_unique ON invoices(number)`,
  `CREATE INDEX IF NOT EXISTS invoices_date_idx ON invoices(date)`,
  `CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices(status)`,

  `CREATE TABLE IF NOT EXISTS invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    code TEXT NOT NULL DEFAULT '',
    name_snapshot TEXT NOT NULL,
    qty REAL NOT NULL DEFAULT 0,
    unit_price REAL NOT NULL DEFAULT 0,
    extra_price REAL NOT NULL DEFAULT 0,
    line_total REAL NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS inventory_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    qty_delta REAL NOT NULL,
    unit_cost REAL NOT NULL DEFAULT 0,
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,

  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  )`,

  `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity TEXT NOT NULL,
    entity_id INTEGER,
    action TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`
]

const DEFAULTS: Record<string, string> = {
  taxRate: '0.05',
  currency: 'OMR',
  currencyDecimals: '3',
  lowStockDefault: '10',
  language: 'en',
  theme: 'light',
  fontSize: '18',
  businessName: 'Abu Salah Projects',
  businessNameAr: 'مشاريع ابو صلاح',
  businessPhone: '',
  businessAddress: '',
  businessEmail: '',
  autoBackup: '1',
  backupKeepDays: '30'
}

export async function bootstrapSchema(): Promise<void> {
  const c = rawClient()
  for (const stmt of DDL_STATEMENTS) {
    await c.execute(stmt)
  }
  // Safe column additions for databases created before this column existed
  try {
    await c.execute("ALTER TABLE customers ADD COLUMN name_en TEXT NOT NULL DEFAULT ''")
  } catch { /* already exists */ }
  for (const [k, v] of Object.entries(DEFAULTS)) {
    await c.execute({
      sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
      args: [k, v]
    })
  }
}
