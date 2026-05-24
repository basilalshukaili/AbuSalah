import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'

import {
  upsertByPhone,
  getById,
  findByPhone,
  search,
  update,
  remove,
  outstandingBalance
} from '@main/domain/customers'
import * as invoices from '@main/domain/invoices'
import * as products from '@main/domain/products'
import { db } from '@main/db/connection'
import { customers as customersTable } from '@main/db/schema'

import { setupTestDb, teardownTestDb } from './setup'

describe('domain/customers', () => {
  let dbFile: string

  beforeEach(async () => {
    dbFile = await setupTestDb()
  })

  afterEach(() => {
    teardownTestDb(dbFile)
  })

  describe('upsertByPhone', () => {
    it('creates a new customer on first call', async () => {
      const c = await upsertByPhone({
        name: 'Hamad',
        phone: '95500512',
        address: 'Muscat',
        email: '',
        notes: ''
      })
      expect(c.id).toBeGreaterThan(0)
      expect(c.name).toBe('Hamad')
      expect(c.phone).toBe('95500512')
    })

    it('is idempotent for the same phone — returns same id and updates name', async () => {
      const first = await upsertByPhone({
        name: 'Old Name',
        phone: '95500512',
        address: '',
        email: '',
        notes: ''
      })
      const second = await upsertByPhone({
        name: 'New Name',
        phone: '95500512',
        address: '',
        email: '',
        notes: ''
      })
      expect(second.id).toBe(first.id)
      expect(second.name).toBe('New Name')

      // Verify only ONE row exists at DB level
      const rows = await db()
        .select()
        .from(customersTable)
        .where(eq(customersTable.phone, '95500512'))
        .all()
      expect(rows.length).toBe(1)
    })

    it('normalizes phone (spaces and dashes removed) before storing', async () => {
      const c = await upsertByPhone({
        name: 'Test',
        phone: ' 9 5 5 0 0 5 1 2 ',
        address: '',
        email: '',
        notes: ''
      })
      expect(c.phone).toBe('95500512')

      // Verify in raw DB
      const row = await db()
        .select()
        .from(customersTable)
        .where(eq(customersTable.id, c.id))
        .get()
      expect(row?.phone).toBe('95500512')
    })

    it('throws when phone is empty', async () => {
      await expect(
        upsertByPhone({ name: 'X', phone: '', address: '', email: '', notes: '' })
      ).rejects.toThrow(/phone is required/)
    })

    it('does not overwrite name with empty string', async () => {
      await upsertByPhone({
        name: 'Original',
        phone: '90000001',
        address: '',
        email: '',
        notes: ''
      })
      const second = await upsertByPhone({
        name: '',
        phone: '90000001',
        address: 'Salalah',
        email: '',
        notes: ''
      })
      expect(second.name).toBe('Original')
      expect(second.address).toBe('Salalah')
    })
  })

  describe('getById / findByPhone', () => {
    it('round-trips a customer', async () => {
      const created = await upsertByPhone({
        name: 'حمد',
        phone: '95500512',
        address: 'Muscat',
        email: 'h@example.com',
        notes: ''
      })
      const got = await getById(created.id)
      expect(got).not.toBeNull()
      expect(got?.name).toBe('حمد')
      expect(got?.phone).toBe('95500512')
    })

    it('getById returns null for missing id', async () => {
      expect(await getById(99999)).toBeNull()
    })

    it('findByPhone normalizes the search input', async () => {
      await upsertByPhone({
        name: 'Test',
        phone: '95500512',
        address: '',
        email: '',
        notes: ''
      })
      const got = await findByPhone(' 9 5 5 0 0 5 1 2 ')
      expect(got).not.toBeNull()
      expect(got?.phone).toBe('95500512')
    })

    it('findByPhone returns null for empty input', async () => {
      expect(await findByPhone('')).toBeNull()
    })

    it('findByPhone returns null for missing phone', async () => {
      expect(await findByPhone('99999999')).toBeNull()
    })
  })

  describe('search', () => {
    beforeEach(async () => {
      await upsertByPhone({
        name: 'Hamad Alboosaidi',
        phone: '95500512',
        address: 'Muscat',
        email: '',
        notes: ''
      })
      await upsertByPhone({
        name: 'Salim',
        phone: '99999999',
        address: 'Salalah',
        email: '',
        notes: ''
      })
      await upsertByPhone({
        name: 'حمد البوسعيدي',
        phone: '92000000',
        address: 'صلالة',
        email: '',
        notes: ''
      })
    })

    it('returns all customers (sorted by name) when term is empty', async () => {
      const all = await search('')
      expect(all.length).toBe(3)
    })

    it('matches by partial Latin name', async () => {
      const r = await search('Hamad')
      expect(r.length).toBe(1)
      expect(r[0].name).toBe('Hamad Alboosaidi')
    })

    it('matches by partial phone', async () => {
      const r = await search('99999')
      expect(r.length).toBe(1)
      expect(r[0].phone).toBe('99999999')
    })

    it('matches by partial address', async () => {
      const r = await search('Salalah')
      expect(r.length).toBe(1)
      expect(r[0].name).toBe('Salim')
    })

    it('matches by partial Arabic name', async () => {
      const r = await search('حمد')
      expect(r.length).toBe(1)
      expect(r[0].name).toBe('حمد البوسعيدي')
    })
  })

  describe('update', () => {
    it('updates a single field', async () => {
      const c = await upsertByPhone({
        name: 'Original',
        phone: '95500512',
        address: '',
        email: '',
        notes: ''
      })
      const updated = await update(c.id, { name: 'Updated' })
      expect(updated.name).toBe('Updated')
      expect(updated.phone).toBe('95500512')
    })

    it('updates phone with normalization', async () => {
      const c = await upsertByPhone({
        name: 'X',
        phone: '95500512',
        address: '',
        email: '',
        notes: ''
      })
      const updated = await update(c.id, { phone: ' +9 6 8-99 999 999 ' })
      expect(updated.phone).toBe('+96899999999')
    })

    it('throws when updating to a phone that already belongs to another customer', async () => {
      const a = await upsertByPhone({
        name: 'A',
        phone: '11111111',
        address: '',
        email: '',
        notes: ''
      })
      await upsertByPhone({
        name: 'B',
        phone: '22222222',
        address: '',
        email: '',
        notes: ''
      })
      await expect(update(a.id, { phone: '22222222' })).rejects.toThrow(/already exists/)
    })

    it('throws when customer not found', async () => {
      await expect(update(99999, { name: 'x' })).rejects.toThrow(/not found/)
    })
  })

  describe('remove', () => {
    it('deletes a customer', async () => {
      const c = await upsertByPhone({
        name: 'X',
        phone: '95500512',
        address: '',
        email: '',
        notes: ''
      })
      await remove(c.id)
      expect(await getById(c.id)).toBeNull()
    })
  })

  describe('outstandingBalance', () => {
    let customerId: number
    let productId: number

    beforeEach(async () => {
      const c = await upsertByPhone({
        name: 'Bal',
        phone: '95500512',
        address: '',
        email: '',
        notes: ''
      })
      customerId = c.id
      const p = await products.create({
        code: 'P1',
        name: 'Item-bal',
        nameAr: '',
        unit: 'm',
        price: 10,
        cost: 5,
        qty: 100,
        lowStockThreshold: 10,
        category: '',
        notes: ''
      })
      productId = p.id
    })

    it('returns 0 for a brand-new customer', async () => {
      const c = await upsertByPhone({
        name: 'Empty',
        phone: '99999999',
        address: '',
        email: '',
        notes: ''
      })
      expect(await outstandingBalance(c.id)).toBe(0)
    })

    it('sums unpaid + partial invoice balances', async () => {
      // Invoice 1: total 100 - advance 20 → balance 80, status partial
      await invoices.create({
        customerName: 'Bal',
        customerPhone: '95500512',
        items: [
          { productId, code: 'P1', name: 'Item-bal', qty: 1, unitPrice: 100, extraPrice: 0 }
        ],
        discount: 0,
        advance: 20,
        taxRate: 0,
        paymentMethod: 'cash',
        notes: '',
        documentType: 'invoice'
      })
      // Invoice 2: total 50 - advance 0 → balance 50, status unpaid
      await invoices.create({
        customerName: 'Bal',
        customerPhone: '95500512',
        items: [
          { productId, code: 'P1', name: 'Item-bal', qty: 1, unitPrice: 50, extraPrice: 0 }
        ],
        discount: 0,
        advance: 0,
        taxRate: 0,
        paymentMethod: 'cash',
        notes: '',
        documentType: 'invoice'
      })

      const out = await outstandingBalance(customerId)
      expect(out).toBeCloseTo(80 + 50, 3)
    })

    it('excludes voided invoices', async () => {
      const inv = await invoices.create({
        customerName: 'Bal',
        customerPhone: '95500512',
        items: [
          { productId, code: 'P1', name: 'Item-bal', qty: 1, unitPrice: 100, extraPrice: 0 }
        ],
        discount: 0,
        advance: 0,
        taxRate: 0,
        paymentMethod: 'cash',
        notes: '',
        documentType: 'invoice'
      })
      await invoices.create({
        customerName: 'Bal',
        customerPhone: '95500512',
        items: [
          { productId, code: 'P1', name: 'Item-bal', qty: 1, unitPrice: 30, extraPrice: 0 }
        ],
        discount: 0,
        advance: 0,
        taxRate: 0,
        paymentMethod: 'cash',
        notes: '',
        documentType: 'invoice'
      })
      await invoices.voidInvoice(inv.id, 'mistake')

      const out = await outstandingBalance(customerId)
      // Only the second invoice (30) counts
      expect(out).toBeCloseTo(30, 3)
    })
  })
})
