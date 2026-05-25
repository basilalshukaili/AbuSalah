import { and, asc, eq, like, lte, or } from 'drizzle-orm'

import type { Product, ProductInput } from '@shared/types'
import { safeNumber } from '@shared/formatting'
import { db } from '../db/connection'
import { inventoryMovements, products } from '../db/schema'

function rowToDto(row: typeof products.$inferSelect): Product {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    nameAr: row.nameAr,
    unit: row.unit,
    price: Number(row.price),
    cost: Number(row.cost),
    qty: Number(row.qty),
    lowStockThreshold: Number(row.lowStockThreshold),
    category: row.category,
    notes: row.notes,
    active: Boolean(row.active),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

export async function create(input: ProductInput): Promise<Product> {
  const name = (input.name ?? '').trim()
  if (!name) throw new Error('name is required')
  const existing = await db().select().from(products).where(eq(products.name, name)).get()
  if (existing) throw new Error(`product '${name}' already exists`)
  const inserted = await db()
    .insert(products)
    .values({
      code: input.code ?? '',
      name,
      nameAr: input.nameAr ?? '',
      unit: input.unit || 'm',
      price: safeNumber(input.price, 0),
      cost: safeNumber(input.cost, 0),
      qty: safeNumber(input.qty, 0),
      lowStockThreshold: safeNumber(input.lowStockThreshold, 10),
      category: input.category ?? '',
      notes: input.notes ?? '',
      active: true
    })
    .returning()
    .get()
  return rowToDto(inserted!)
}

export async function upsertByName(input: ProductInput): Promise<Product> {
  const name = (input.name ?? '').trim()
  if (!name) throw new Error('name is required')
  const existing = await db().select().from(products).where(eq(products.name, name)).get()
  if (!existing) return create(input)
  const updates = {
    code: input.code ?? existing.code,
    nameAr: input.nameAr ?? existing.nameAr,
    unit: input.unit || existing.unit,
    price: input.price !== undefined ? safeNumber(input.price, existing.price) : existing.price,
    cost: input.cost !== undefined ? safeNumber(input.cost, existing.cost) : existing.cost,
    qty: input.qty !== undefined ? safeNumber(input.qty, existing.qty) : existing.qty,
    lowStockThreshold:
      input.lowStockThreshold !== undefined
        ? safeNumber(input.lowStockThreshold, existing.lowStockThreshold)
        : existing.lowStockThreshold,
    category: input.category ?? existing.category,
    notes: input.notes ?? existing.notes,
    updatedAt: new Date().toISOString()
  }
  await db().update(products).set(updates).where(eq(products.id, existing.id)).run()
  const fresh = await db().select().from(products).where(eq(products.id, existing.id)).get()
  return rowToDto(fresh!)
}

export async function getById(id: number): Promise<Product | null> {
  const row = await db().select().from(products).where(eq(products.id, id)).get()
  return row ? rowToDto(row) : null
}

export async function findByName(name: string): Promise<Product | null> {
  if (!name) return null
  const row = await db().select().from(products).where(eq(products.name, name)).get()
  return row ? rowToDto(row) : null
}

export async function list(opts: {
  term?: string
  lowStockOnly?: boolean
  activeOnly?: boolean
} = {}): Promise<Product[]> {
  const term = (opts.term ?? '').trim()
  const conditions = []
  if (opts.activeOnly !== false) conditions.push(eq(products.active, true))
  if (term) {
    const like_ = `%${term}%`
    conditions.push(or(like(products.name, like_), like(products.nameAr, like_), like(products.code, like_)))
  }
  if (opts.lowStockOnly) conditions.push(lte(products.qty, products.lowStockThreshold))

  const baseQuery = db().select().from(products)
  const filtered = conditions.length ? baseQuery.where(and(...conditions)) : baseQuery
  const rows = await filtered.orderBy(asc(products.name)).all()
  return rows.map(rowToDto)
}

export async function update(id: number, patch: Partial<ProductInput>): Promise<Product> {
  const existing = await db().select().from(products).where(eq(products.id, id)).get()
  if (!existing) throw new Error(`product ${id} not found`)
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }
  if (patch.code !== undefined) updates.code = patch.code
  if (patch.name !== undefined) updates.name = patch.name.trim()
  if (patch.nameAr !== undefined) updates.nameAr = patch.nameAr
  if (patch.unit !== undefined) updates.unit = patch.unit
  if (patch.price !== undefined) updates.price = safeNumber(patch.price)
  if (patch.cost !== undefined) updates.cost = safeNumber(patch.cost)
  if (patch.qty !== undefined) updates.qty = safeNumber(patch.qty)
  if (patch.lowStockThreshold !== undefined) updates.lowStockThreshold = safeNumber(patch.lowStockThreshold, 10)
  if (patch.category !== undefined) updates.category = patch.category
  if (patch.notes !== undefined) updates.notes = patch.notes
  await db().update(products).set(updates).where(eq(products.id, id)).run()
  const fresh = await db().select().from(products).where(eq(products.id, id)).get()
  return rowToDto(fresh!)
}

export async function softDelete(id: number): Promise<void> {
  await db()
    .update(products)
    .set({ active: false, updatedAt: new Date().toISOString() })
    .where(eq(products.id, id))
    .run()
}

export async function restock(id: number, qty: number, reason: string): Promise<Product> {
  const existing = await db().select().from(products).where(eq(products.id, id)).get()
  if (!existing) throw new Error(`product ${id} not found`)
  const addQty = safeNumber(qty, 0)
  const newQty = safeNumber(existing.qty) + addQty
  await db()
    .update(products)
    .set({ qty: newQty, updatedAt: new Date().toISOString() })
    .where(eq(products.id, id))
    .run()
  await db()
    .insert(inventoryMovements)
    .values({
      productId: id,
      kind: 'restock',
      qtyDelta: addQty,
      unitCost: safeNumber(existing.cost),
      reason: reason || ''
    })
    .run()
  const fresh = await db().select().from(products).where(eq(products.id, id)).get()
  return rowToDto(fresh!)
}

export async function adjust(id: number, newQty: number, reason: string): Promise<Product> {
  const existing = await db().select().from(products).where(eq(products.id, id)).get()
  if (!existing) throw new Error(`product ${id} not found`)
  const target = safeNumber(newQty, safeNumber(existing.qty))
  const delta = target - safeNumber(existing.qty)
  await db()
    .update(products)
    .set({ qty: target, updatedAt: new Date().toISOString() })
    .where(eq(products.id, id))
    .run()
  await db()
    .insert(inventoryMovements)
    .values({ productId: id, kind: 'adjust', qtyDelta: delta, reason: reason || 'manual adjust' })
    .run()
  const fresh = await db().select().from(products).where(eq(products.id, id)).get()
  return rowToDto(fresh!)
}

export async function lowStock(): Promise<Product[]> {
  const rows = await db()
    .select()
    .from(products)
    .where(and(eq(products.active, true), lte(products.qty, products.lowStockThreshold)))
    .orderBy(asc(products.qty))
    .all()
  return rows.map(rowToDto)
}
