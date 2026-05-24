import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'

import { importAll } from '@main/services/legacy-import'
import { db } from '@main/db/connection'
import { customers, invoices, products } from '@main/db/schema'

import { setupTestDb, teardownTestDb } from './setup'

function makeFixtureRoot(): { root: string; itemsDir: string; billsDir: string } {
  const root = join(tmpdir(), 'abusalah_legacy_fixture_' + randomUUID())
  const itemsDir = join(root, 'items')
  const billsDir = join(root, 'bills')
  mkdirSync(itemsDir, { recursive: true })
  mkdirSync(billsDir, { recursive: true })
  return { root, itemsDir, billsDir }
}

function cleanupFixture(root: string): void {
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

describe('legacy-import — importAll', () => {
  let dbFile: string
  let fixtures: ReturnType<typeof makeFixtureRoot>

  beforeEach(async () => {
    dbFile = await setupTestDb()
    fixtures = makeFixtureRoot()
  })

  afterEach(() => {
    teardownTestDb(dbFile)
    cleanupFixture(fixtures.root)
  })

  it('imports products from the items directory', async () => {
    writeFileSync(join(fixtures.itemsDir, 'Curtain raw'), '101,6.5,100')
    writeFileSync(join(fixtures.itemsDir, 'Track aluminum'), '202,12.0,50')

    const result = await importAll({
      itemsDir: fixtures.itemsDir,
      billsDir: fixtures.billsDir
    })

    expect(result.products).toBe(2)

    const rows = await db().select().from(products).all()
    expect(rows.length).toBe(2)
    expect(rows.map((r) => r.name).sort()).toEqual(['Curtain raw', 'Track aluminum'])

    const curtain = rows.find((r) => r.name === 'Curtain raw')!
    expect(Number(curtain.price)).toBeCloseTo(6.5, 3)
    expect(Number(curtain.qty)).toBe(100)
    expect(curtain.code).toBe('101')
  })

  it('skips products that already exist (idempotent)', async () => {
    writeFileSync(join(fixtures.itemsDir, 'Curtain raw'), '101,6.5,100')

    const first = await importAll({
      itemsDir: fixtures.itemsDir,
      billsDir: fixtures.billsDir
    })
    expect(first.products).toBe(1)

    const second = await importAll({
      itemsDir: fixtures.itemsDir,
      billsDir: fixtures.billsDir
    })
    expect(second.products).toBe(0)
    expect(second.skippedProducts).toBe(1)

    const rows = await db().select().from(products).all()
    expect(rows.length).toBe(1)
  })

  it('imports a customer from a bill filename even when bill lines do not parse', async () => {
    // Note: with the current parsePyLiteral bug, ALL multi-element bill lines
    // fail to parse.  But the customer should still be created from the
    // filename (because the importer creates a customer row before iterating
    // bill lines).
    const billPath = join(fixtures.billsDir, '95500512.txt')
    writeFileSync(
      billPath,
      "41-[['111', 'X', '1', 105.0, '105.0']]-110.25-20-12 / 11 / 2022-5.25-Hamad-note\n"
    )

    const result = await importAll({
      itemsDir: fixtures.itemsDir,
      billsDir: fixtures.billsDir
    })

    expect(result.customers).toBe(1)

    const rows = await db().select().from(customers).all()
    expect(rows.length).toBe(1)
    expect(rows[0].phone).toBe('95500512')
  })

  it('imports a bill line that uses an empty items array (which DOES parse correctly)', async () => {
    // Use a "header-only" bill line that the parser CAN handle today.
    const billPath = join(fixtures.billsDir, '95500512.txt')
    writeFileSync(
      billPath,
      '7-[]-100-50-01 / 01 / 2023-0-Hamad-some note\n'
    )

    const result = await importAll({
      itemsDir: fixtures.itemsDir,
      billsDir: fixtures.billsDir
    })

    expect(result.customers).toBe(1)
    expect(result.invoices).toBe(1)

    const rows = await db().select().from(invoices).all()
    expect(rows.length).toBe(1)
    expect(rows[0].number).toBe(7)
    expect(Number(rows[0].total)).toBeCloseTo(100, 3)
    expect(Number(rows[0].advance)).toBe(50)
    expect(rows[0].notes).toBe('some note')

    // Customer name was filled in from the bill line
    const c = await db().select().from(customers).where(eq(customers.phone, '95500512')).get()
    expect(c?.name).toBe('Hamad')
  })

  it('importing the same bill file twice is idempotent (same invoice number is skipped)', async () => {
    const billPath = join(fixtures.billsDir, '95500512.txt')
    writeFileSync(
      billPath,
      '7-[]-100-50-01 / 01 / 2023-0-Hamad-some note\n'
    )

    const first = await importAll({
      itemsDir: fixtures.itemsDir,
      billsDir: fixtures.billsDir
    })
    expect(first.invoices).toBe(1)

    const second = await importAll({
      itemsDir: fixtures.itemsDir,
      billsDir: fixtures.billsDir
    })
    expect(second.invoices).toBe(0)
    expect(second.customers).toBe(0)

    const rows = await db().select().from(invoices).all()
    expect(rows.length).toBe(1)
  })

  it('counts unparsed lines in the summary', async () => {
    const billPath = join(fixtures.billsDir, '95500512.txt')
    writeFileSync(
      billPath,
      [
        '7-[]-100-50-01 / 01 / 2023-0-Hamad-good',
        'completely-malformed-no-bracket-line',
        '8-[]-50-0-02 / 01 / 2023-0-Hamad-second'
      ].join('\n')
    )

    const result = await importAll({
      itemsDir: fixtures.itemsDir,
      billsDir: fixtures.billsDir
    })
    expect(result.invoices).toBe(2)
    expect(result.unparsedLines).toBeGreaterThanOrEqual(1)
  })

  it('returns zeros when no directories exist', async () => {
    const result = await importAll({
      itemsDir: join(fixtures.root, 'no-items'),
      billsDir: join(fixtures.root, 'no-bills')
    })
    expect(result).toMatchObject({
      products: 0,
      invoices: 0,
      customers: 0
    })
  })

  it('skips bill files whose name does not normalize to a non-empty phone', async () => {
    // empty extensionless name like "_" would yield empty after normalizePhone
    writeFileSync(join(fixtures.billsDir, 'no-digits-here.txt'), '')

    const result = await importAll({
      itemsDir: fixtures.itemsDir,
      billsDir: fixtures.billsDir
    })
    expect(result.customers).toBe(0)
    expect(result.invoices).toBe(0)
  })

  it('respects the file extension on bill names (e.g. "95500512.bak" still imports as 95500512)', async () => {
    writeFileSync(
      join(fixtures.billsDir, '95500512.bak'),
      '7-[]-100-0-01 / 01 / 2023-0-Hamad-x\n'
    )
    const result = await importAll({
      itemsDir: fixtures.itemsDir,
      billsDir: fixtures.billsDir
    })
    expect(result.customers).toBe(1)
    expect(result.invoices).toBe(1)
    const c = await db().select().from(customers).where(eq(customers.phone, '95500512')).get()
    expect(c).toBeDefined()
  })
})
