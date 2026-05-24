/**
 * E2E test that verifies the legacy bills/items folders are imported
 * correctly when the operator triggers it from Settings.
 */

import { _electron as electron, expect, test } from '@playwright/test'
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('legacy bills/items folder imports successfully', async () => {
  const userData = join(tmpdir(), `abusalah-import-${Date.now()}`)
  if (existsSync(userData)) rmSync(userData, { recursive: true, force: true })
  mkdirSync(userData, { recursive: true })

  // Stage legacy data next to the user-data dir, where paths() expects it.
  const legacyDir = join(userData, '..', 'AbuSalahLegacy')
  if (existsSync(legacyDir)) rmSync(legacyDir, { recursive: true, force: true })
  mkdirSync(legacyDir, { recursive: true })

  const realLegacyRoot = join(process.cwd(), '..')
  cpSync(join(realLegacyRoot, 'bills'), join(legacyDir, 'bills'), { recursive: true })
  cpSync(join(realLegacyRoot, 'items'), join(legacyDir, 'items'), { recursive: true })

  console.log('[test] legacyDir =', legacyDir)
  console.log('[test] bills =', readdirSync(join(legacyDir, 'bills')).length)
  console.log('[test] items =', readdirSync(join(legacyDir, 'items')).length)

  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`]
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  // Trigger import via window.api directly (bypasses UI workflow)
  const result = await win.evaluate(async () =>
    (window as unknown as { api: { legacyImport: () => Promise<{ products: number; invoices: number; customers: number }> } }).api.legacyImport()
  )
  console.log('[test] import result:', result)

  expect(result.products).toBeGreaterThan(80)
  expect(result.invoices).toBeGreaterThan(15)
  expect(result.customers).toBeGreaterThan(5)

  // Verify search returns the imported invoices and Arabic strings round-trip
  const invoices = await win.evaluate(async () =>
    (window as unknown as { api: { invoicesSearch: (f: object) => Promise<Array<{ number: number; customerName: string; items: Array<{ nameSnapshot: string }> }>> } }).api.invoicesSearch({ limit: 5 })
  )
  console.log('[test] sample invoice:', JSON.stringify(invoices[0], null, 2).slice(0, 800))
  expect(invoices.length).toBeGreaterThan(0)

  // At least one invoice or item should contain Arabic — proving the parser
  // handled the legacy file content correctly without mojibake.
  const arabicRange = /[؀-ۿ]/
  const anyArabic = invoices.some(
    (inv) =>
      arabicRange.test(inv.customerName) ||
      inv.items.some((it) => arabicRange.test(it.nameSnapshot))
  )
  expect(anyArabic, 'imported invoices should contain Arabic content').toBe(true)

  await app.close()
})
