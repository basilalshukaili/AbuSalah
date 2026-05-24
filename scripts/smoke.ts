/**
 * Smoke test for the domain layer — verifies the whole stack works against an
 * in-memory libsql DB before we wire up Electron / React.
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { configureDatabase, closeDatabase } from '../src/main/db/connection'
import { bootstrapSchema } from '../src/main/db/bootstrap'
import * as customers from '../src/main/domain/customers'
import * as products from '../src/main/domain/products'
import * as invoices from '../src/main/domain/invoices'
import * as reports from '../src/main/domain/reports'
import { getAllSettings, updateSettings } from '../src/main/db/settings-repo'

async function main() {
  const dbFile = join(tmpdir(), `abusalah_smoke_${Date.now()}.sqlite3`)
  console.log('DB:', dbFile)
  await configureDatabase(dbFile)
  await bootstrapSchema()

  // 1. Settings
  const s = await getAllSettings()
  console.log('default settings:', { tax: s.taxRate, currency: s.currency, lang: s.language })

  // 2. Create a product (Arabic name)
  const p = await products.create({
    name: 'Curtain raw',
    nameAr: 'ستائر خام',
    code: '101',
    unit: 'm',
    price: 6.5,
    cost: 4,
    qty: 100,
    lowStockThreshold: 10,
    category: 'curtains',
    notes: ''
  })
  console.log('product created:', p.id, p.name, '/', p.nameAr)

  // 3. Create an invoice with multiple items and tax
  const inv = await invoices.create({
    customerName: 'حمد البوسعيدي',
    customerNameEn: 'Hamad Al-Busaidi',
    customerPhone: '95500512',
    items: [
      {
        productId: p.id,
        code: p.code,
        name: p.name,
        qty: 5,
        unitPrice: p.price,
        extraPrice: 0
      }
    ],
    discount: 0,
    advance: 10,
    taxRate: 0.05,
    paymentMethod: 'cash',
    notes: 'بدون التوصيل',
    documentType: 'invoice'
  })
  console.log('invoice created:', inv.number, 'total=', inv.total, 'balance=', inv.balance)
  console.log('  customer:', inv.customerName, '|', inv.customerPhone)

  // 4. Verify stock decremented
  const pAfter = await products.getById(p.id)
  console.log('product qty after sale (expected 95):', pAfter?.qty)
  if (pAfter?.qty !== 95) throw new Error('stock not decremented correctly')

  // 5. Search invoices by phone
  const found = await invoices.search({ term: '95500512' })
  console.log('search by phone returned:', found.length, 'invoices')
  if (found.length !== 1) throw new Error('search failed')

  // 6. Customer outstanding
  const cId = inv.customerId!
  const balance = await customers.outstandingBalance(cId)
  console.log('customer outstanding (expected', inv.balance, '):', balance)

  // 7. KPI report (today)
  const today = new Date().toISOString().slice(0, 10)
  const k = await reports.kpis({ start: today, end: today })
  console.log('kpis today:', k)

  // 8. Void invoice & verify stock restored
  await invoices.voidInvoice(inv.id, 'wrong customer')
  const pAfterVoid = await products.getById(p.id)
  console.log('product qty after void (expected 100):', pAfterVoid?.qty)
  if (pAfterVoid?.qty !== 100) throw new Error('void did not restore stock')

  // 9. Settings update
  await updateSettings({ language: 'ar', theme: 'dark' })
  const s2 = await getAllSettings()
  console.log('settings after update:', { lang: s2.language, theme: s2.theme })

  closeDatabase()
  console.log('\n✅ SMOKE TEST PASSED')
}

main().catch((e) => {
  console.error('❌ SMOKE TEST FAILED:', e)
  process.exit(1)
})
