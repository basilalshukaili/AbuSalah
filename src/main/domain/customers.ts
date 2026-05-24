import { and, eq, like, ne, or, sql } from 'drizzle-orm'

import type { Customer, CustomerInput } from '@shared/types'
import { normalizePhone } from '@shared/formatting'
import { db } from '../db/connection'
import { customers, invoices } from '../db/schema'

function rowToDto(row: typeof customers.$inferSelect): Customer {
  return {
    id: row.id,
    name: row.name,
    nameEn: row.nameEn ?? '',
    phone: row.phone,
    address: row.address,
    email: row.email,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

export async function upsertByPhone(input: CustomerInput): Promise<Customer> {
  const phone = normalizePhone(input.phone)
  if (!phone) throw new Error('phone is required')
  const existing = await db().select().from(customers).where(eq(customers.phone, phone)).get()
  if (existing) {
    const next = {
      name: input.name?.trim() || existing.name,
      nameEn: input.nameEn?.trim() || existing.nameEn,
      address: input.address ?? existing.address,
      email: input.email ?? existing.email,
      notes: input.notes ?? existing.notes,
      updatedAt: new Date().toISOString()
    }
    await db().update(customers).set(next).where(eq(customers.id, existing.id)).run()
    const updated = await db().select().from(customers).where(eq(customers.id, existing.id)).get()
    return rowToDto(updated!)
  }
  const result = await db()
    .insert(customers)
    .values({
      phone,
      name: input.name?.trim() || '',
      nameEn: input.nameEn?.trim() || '',
      address: input.address ?? '',
      email: input.email ?? '',
      notes: input.notes ?? ''
    })
    .returning()
    .get()
  return rowToDto(result!)
}

export async function getById(id: number): Promise<Customer | null> {
  const row = await db().select().from(customers).where(eq(customers.id, id)).get()
  return row ? rowToDto(row) : null
}

export async function findByPhone(phone: string): Promise<Customer | null> {
  const p = normalizePhone(phone)
  if (!p) return null
  const row = await db().select().from(customers).where(eq(customers.phone, p)).get()
  return row ? rowToDto(row) : null
}

export async function search(term: string): Promise<Customer[]> {
  const q = (term || '').trim()
  let rows
  if (!q) {
    rows = await db().select().from(customers).orderBy(customers.name).all()
  } else {
    const like_ = `%${q}%`
    rows = await db()
      .select()
      .from(customers)
      .where(
        or(
          like(customers.name, like_),
          like(customers.nameEn, like_),
          like(customers.phone, like_),
          like(customers.address, like_)
        )
      )
      .orderBy(customers.name)
      .all()
  }
  return rows.map(rowToDto)
}

export async function update(id: number, patch: Partial<CustomerInput>): Promise<Customer> {
  const existing = await db().select().from(customers).where(eq(customers.id, id)).get()
  if (!existing) throw new Error(`customer ${id} not found`)
  if (patch.phone) {
    const newPhone = normalizePhone(patch.phone)
    if (newPhone && newPhone !== existing.phone) {
      const clash = await db()
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.phone, newPhone), ne(customers.id, id)))
        .get()
      if (clash) throw new Error(`another customer with phone ${newPhone} already exists`)
    }
  }
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }
  if (patch.name !== undefined) updates.name = patch.name.trim()
  if (patch.nameEn !== undefined) updates.nameEn = patch.nameEn.trim()
  if (patch.phone !== undefined) updates.phone = normalizePhone(patch.phone)
  if (patch.address !== undefined) updates.address = patch.address
  if (patch.email !== undefined) updates.email = patch.email
  if (patch.notes !== undefined) updates.notes = patch.notes
  await db().update(customers).set(updates).where(eq(customers.id, id)).run()
  const fresh = await db().select().from(customers).where(eq(customers.id, id)).get()
  return rowToDto(fresh!)
}

export async function remove(id: number): Promise<void> {
  // Detach invoices but keep history
  await db().update(invoices).set({ customerId: null }).where(eq(invoices.customerId, id)).run()
  await db().delete(customers).where(eq(customers.id, id)).run()
}

export async function outstandingBalance(customerId: number): Promise<number> {
  const row = await db()
    .select({ total: sql<number>`COALESCE(SUM(${invoices.balance}), 0)` })
    .from(invoices)
    .where(and(eq(invoices.customerId, customerId), ne(invoices.status, 'void')))
    .get()
  return Number(row?.total ?? 0)
}
