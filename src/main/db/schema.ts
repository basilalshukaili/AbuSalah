import { sql } from 'drizzle-orm'
import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`

export const customers = sqliteTable(
  'customers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull().default(''),
    nameEn: text('name_en').notNull().default(''),
    phone: text('phone').notNull(),
    address: text('address').notNull().default(''),
    email: text('email').notNull().default(''),
    notes: text('notes').notNull().default(''),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now)
  },
  (t) => ({
    phoneUnique: uniqueIndex('customers_phone_unique').on(t.phone)
  })
)

export const products = sqliteTable(
  'products',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    code: text('code').notNull().default(''),
    name: text('name').notNull(),
    nameAr: text('name_ar').notNull().default(''),
    unit: text('unit').notNull().default('m'),
    price: real('price').notNull().default(0),
    cost: real('cost').notNull().default(0),
    qty: real('qty').notNull().default(0),
    lowStockThreshold: real('low_stock_threshold').notNull().default(10),
    category: text('category').notNull().default(''),
    notes: text('notes').notNull().default(''),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now)
  },
  (t) => ({
    nameUnique: uniqueIndex('products_name_unique').on(t.name)
  })
)

export const invoices = sqliteTable(
  'invoices',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    number: integer('number').notNull(),
    customerId: integer('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    date: text('date').notNull().default(now),
    subtotal: real('subtotal').notNull().default(0),
    discount: real('discount').notNull().default(0),
    taxRate: real('tax_rate').notNull().default(0.05),
    taxAmount: real('tax_amount').notNull().default(0),
    total: real('total').notNull().default(0),
    advance: real('advance').notNull().default(0),
    balance: real('balance').notNull().default(0),
    paymentMethod: text('payment_method').notNull().default('cash'),
    status: text('status').notNull().default('unpaid'),
    documentType: text('document_type').notNull().default('invoice'),
    notes: text('notes').notNull().default(''),
    voidedAt: text('voided_at'),
    voidedReason: text('voided_reason').notNull().default(''),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now)
  },
  (t) => ({
    numberUnique: uniqueIndex('invoices_number_unique').on(t.number)
  })
)

export const invoiceItems = sqliteTable('invoice_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  invoiceId: integer('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  productId: integer('product_id').references(() => products.id, { onDelete: 'set null' }),
  code: text('code').notNull().default(''),
  nameSnapshot: text('name_snapshot').notNull(),
  qty: real('qty').notNull().default(0),
  unitPrice: real('unit_price').notNull().default(0),
  extraPrice: real('extra_price').notNull().default(0),
  lineTotal: real('line_total').notNull().default(0)
})

export const inventoryMovements = sqliteTable('inventory_movements', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  invoiceId: integer('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
  kind: text('kind').notNull(), // sale | restock | adjust | void_reversal
  qtyDelta: real('qty_delta').notNull(),
  unitCost: real('unit_cost').notNull().default(0),
  reason: text('reason').notNull().default(''),
  createdAt: text('created_at').notNull().default(now)
})

export const settingsTable = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull().default('')
})

export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  entity: text('entity').notNull(),
  entityId: integer('entity_id'),
  action: text('action').notNull(),
  details: text('details').notNull().default(''),
  createdAt: text('created_at').notNull().default(now)
})

export type CustomerRow = typeof customers.$inferSelect
export type ProductRow = typeof products.$inferSelect
export type InvoiceRow = typeof invoices.$inferSelect
export type InvoiceItemRow = typeof invoiceItems.$inferSelect
export type InventoryMovementRow = typeof inventoryMovements.$inferSelect
export type SettingRow = typeof settingsTable.$inferSelect
