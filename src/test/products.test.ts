import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq, desc } from 'drizzle-orm'

import {
  create,
  upsertByName,
  getById,
  findByName,
  list,
  update,
  softDelete,
  restock,
  adjust,
  lowStock
} from '@main/domain/products'
import { db } from '@main/db/connection'
import { inventoryMovements, products as productsTable } from '@main/db/schema'

import { setupTestDb, teardownTestDb } from './setup'

const baseInput = {
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

describe('domain/products', () => {
  let dbFile: string

  beforeEach(async () => {
    dbFile = await setupTestDb()
  })

  afterEach(() => {
    teardownTestDb(dbFile)
  })

  describe('create', () => {
    it('creates a product and returns full DTO', async () => {
      const p = await create(baseInput)
      expect(p.id).toBeGreaterThan(0)
      expect(p.name).toBe('Curtain raw')
      expect(p.nameAr).toBe('ستائر خام')
      expect(p.qty).toBe(100)
      expect(p.active).toBe(true)
    })

    it('rejects duplicate names', async () => {
      await create(baseInput)
      await expect(create(baseInput)).rejects.toThrow(/already exists/)
    })

    it('rejects empty names', async () => {
      await expect(create({ ...baseInput, name: '' })).rejects.toThrow(/name is required/)
    })

    it('trims surrounding whitespace from name', async () => {
      const p = await create({ ...baseInput, name: '  Curtain raw  ' })
      expect(p.name).toBe('Curtain raw')
    })
  })

  describe('upsertByName', () => {
    it('creates a product if name is new', async () => {
      const p = await upsertByName(baseInput)
      expect(p.id).toBeGreaterThan(0)
      expect(p.name).toBe('Curtain raw')
    })

    it('updates an existing product instead of erroring out', async () => {
      const first = await upsertByName(baseInput)
      const second = await upsertByName({ ...baseInput, price: 9.99, qty: 50 })
      expect(second.id).toBe(first.id)
      expect(second.price).toBe(9.99)
      expect(second.qty).toBe(50)

      const rows = await db()
        .select()
        .from(productsTable)
        .where(eq(productsTable.name, 'Curtain raw'))
        .all()
      expect(rows.length).toBe(1)
    })
  })

  describe('getById / findByName', () => {
    it('round-trips a product by id', async () => {
      const p = await create(baseInput)
      const got = await getById(p.id)
      expect(got).not.toBeNull()
      expect(got?.name).toBe('Curtain raw')
    })

    it('getById returns null for missing id', async () => {
      expect(await getById(99999)).toBeNull()
    })

    it('findByName returns the product', async () => {
      await create(baseInput)
      const got = await findByName('Curtain raw')
      expect(got?.name).toBe('Curtain raw')
    })

    it('findByName returns null for missing name', async () => {
      expect(await findByName('Nope')).toBeNull()
    })

    it('findByName returns null for empty input', async () => {
      expect(await findByName('')).toBeNull()
    })
  })

  describe('list', () => {
    beforeEach(async () => {
      await create({ ...baseInput, name: 'Curtain raw', nameAr: 'ستائر خام', code: 'C1', qty: 100 })
      await create({ ...baseInput, name: 'Track aluminum', nameAr: 'سكة', code: 'T1', qty: 5, lowStockThreshold: 10 })
      await create({ ...baseInput, name: 'Hidden item', nameAr: 'مخفي', code: 'H1', qty: 50 })
    })

    it('returns active products by default', async () => {
      const rows = await list()
      expect(rows.length).toBe(3)
      // sorted by name ascending
      expect(rows.map((r) => r.name)).toEqual(['Curtain raw', 'Hidden item', 'Track aluminum'])
    })

    it('matches term against English name', async () => {
      const rows = await list({ term: 'Curtain' })
      expect(rows.length).toBe(1)
      expect(rows[0].name).toBe('Curtain raw')
    })

    it('matches term against Arabic name', async () => {
      const rows = await list({ term: 'سكة' })
      expect(rows.length).toBe(1)
      expect(rows[0].name).toBe('Track aluminum')
    })

    it('matches term against code', async () => {
      const rows = await list({ term: 'H1' })
      expect(rows.length).toBe(1)
      expect(rows[0].name).toBe('Hidden item')
    })

    it('lowStockOnly returns only products with qty <= threshold', async () => {
      const rows = await list({ lowStockOnly: true })
      expect(rows.length).toBe(1)
      expect(rows[0].name).toBe('Track aluminum')
    })

    it('activeOnly: false includes soft-deleted', async () => {
      const all = await list({ term: 'Hidden' })
      const target = all[0]
      await softDelete(target.id)

      const activeOnly = await list({ term: 'Hidden' })
      expect(activeOnly.length).toBe(0)

      const includeInactive = await list({ term: 'Hidden', activeOnly: false })
      expect(includeInactive.length).toBe(1)
      expect(includeInactive[0].active).toBe(false)
    })
  })

  describe('update', () => {
    it('updates fields', async () => {
      const p = await create(baseInput)
      const u = await update(p.id, { price: 12.5, category: 'fabric' })
      expect(u.price).toBe(12.5)
      expect(u.category).toBe('fabric')
      // unchanged
      expect(u.qty).toBe(100)
    })

    it('throws when product not found', async () => {
      await expect(update(99999, { price: 1 })).rejects.toThrow(/not found/)
    })
  })

  describe('softDelete', () => {
    it('flips active=false but row remains', async () => {
      const p = await create(baseInput)
      await softDelete(p.id)
      const got = await getById(p.id)
      expect(got).not.toBeNull()
      expect(got?.active).toBe(false)
    })

    it('softDeleted product can still be queried with activeOnly:false', async () => {
      const p = await create(baseInput)
      await softDelete(p.id)
      const rows = await list({ activeOnly: false })
      expect(rows.find((r) => r.id === p.id)).toBeDefined()
    })
  })

  describe('restock', () => {
    it('adds to qty and creates an inventory_movements row with kind=restock and positive qtyDelta', async () => {
      const p = await create(baseInput) // qty=100
      const u = await restock(p.id, 50, 'monthly delivery')
      expect(u.qty).toBe(150)

      const rows = await db()
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.productId, p.id))
        .orderBy(desc(inventoryMovements.id))
        .all()
      expect(rows.length).toBe(1)
      expect(rows[0].kind).toBe('restock')
      expect(rows[0].qtyDelta).toBe(50)
      expect(rows[0].reason).toBe('monthly delivery')
    })

    it('restock 0 still writes a movement row', async () => {
      const p = await create(baseInput)
      await restock(p.id, 0, 'audit')
      const rows = await db()
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.productId, p.id))
        .all()
      expect(rows.length).toBe(1)
      expect(rows[0].qtyDelta).toBe(0)
    })

    it('throws on missing product', async () => {
      await expect(restock(99999, 5, '')).rejects.toThrow(/not found/)
    })
  })

  describe('adjust', () => {
    it('sets qty to absolute value and creates a movement with the correct delta', async () => {
      const p = await create({ ...baseInput, qty: 100 })
      const u = await adjust(p.id, 75, 'shrinkage')
      expect(u.qty).toBe(75)

      const rows = await db()
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.productId, p.id))
        .all()
      expect(rows.length).toBe(1)
      expect(rows[0].kind).toBe('adjust')
      expect(rows[0].qtyDelta).toBe(-25)
      expect(rows[0].reason).toBe('shrinkage')
    })

    it('positive delta when adjusting upward', async () => {
      const p = await create({ ...baseInput, qty: 10 })
      const u = await adjust(p.id, 30, '')
      expect(u.qty).toBe(30)
      const rows = await db()
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.productId, p.id))
        .all()
      expect(rows[0].qtyDelta).toBe(20)
    })

    it('throws on missing product', async () => {
      await expect(adjust(99999, 5, '')).rejects.toThrow(/not found/)
    })
  })

  describe('lowStock', () => {
    it('returns active products at or below threshold, sorted by qty ascending', async () => {
      await create({ ...baseInput, name: 'OK item', qty: 100, lowStockThreshold: 10 })
      await create({ ...baseInput, name: 'Low item A', qty: 5, lowStockThreshold: 10 })
      await create({ ...baseInput, name: 'Low item B', qty: 3, lowStockThreshold: 10 })

      const rows = await lowStock()
      expect(rows.length).toBe(2)
      // sorted ascending by qty
      expect(rows[0].name).toBe('Low item B')
      expect(rows[1].name).toBe('Low item A')
    })

    it('excludes soft-deleted products', async () => {
      const p = await create({ ...baseInput, name: 'Soft Low', qty: 1, lowStockThreshold: 10 })
      await softDelete(p.id)
      const rows = await lowStock()
      expect(rows.find((r) => r.id === p.id)).toBeUndefined()
    })
  })
})
