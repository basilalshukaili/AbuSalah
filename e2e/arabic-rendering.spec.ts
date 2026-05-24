/**
 * E2E test that validates Arabic rendering visibly.
 * Launches the packaged Electron app, switches to Arabic, takes screenshots
 * of Dashboard / New Invoice / Search, and verifies that:
 *   - the document direction flips to RTL,
 *   - the text content of nav links matches expected Arabic strings,
 *   - the Arabic strings actually contain Arabic-range Unicode (no mojibake).
 */

import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCREENSHOT_DIR = join(process.cwd(), 'e2e', 'screenshots')

const ARABIC_RANGE = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/
function hasArabic(s: string): boolean {
  return ARABIC_RANGE.test(s)
}

test.beforeAll(() => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true })
})

test('Arabic UI renders correctly with proper Unicode and RTL layout', async () => {
  // Use a fresh user-data dir so we get a clean DB.
  const userData = join(tmpdir(), `abusalah-e2e-${Date.now()}`)
  if (existsSync(userData)) rmSync(userData, { recursive: true, force: true })

  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  // Wait for boot
  await window.waitForSelector('h1', { timeout: 15_000 })
  await window.waitForFunction(
    () => document.fonts && document.fonts.status === 'loaded',
    { timeout: 5000 }
  )
  await window.screenshot({ path: join(SCREENSHOT_DIR, '01-en-dashboard.png'), fullPage: true })

  // Switch to Arabic via the language toggle
  const langButton = window.locator('button[aria-label="Toggle language"]').first()
  await langButton.click()

  // Wait for layout to flip to RTL
  await window.waitForFunction(() => document.documentElement.dir === 'rtl', { timeout: 5000 })

  // Re-wait for fonts (Cairo) since we re-styled
  await window.waitForFunction(
    () => document.fonts && document.fonts.status === 'loaded',
    { timeout: 5000 }
  )
  // Allow a frame for layout reflow
  await window.waitForTimeout(400)
  await window.screenshot({ path: join(SCREENSHOT_DIR, '02-ar-dashboard.png'), fullPage: true })

  // Verify dir is rtl
  const dir = await window.evaluate(() => document.documentElement.dir)
  expect(dir).toBe('rtl')

  // Read the visible nav button labels and verify they contain Arabic
  const navTexts = await window
    .locator('aside a span')
    .allTextContents()
  expect(navTexts.length).toBeGreaterThan(0)
  const navContainsArabic = navTexts.filter(hasArabic).length
  expect(navContainsArabic, `nav items should be in Arabic: ${navTexts.join(' / ')}`).toBeGreaterThanOrEqual(5)

  // Specifically expect "الرئيسية" (dashboard) and "فاتورة جديدة" (new invoice)
  const flat = navTexts.join('|')
  expect(flat).toContain('الرئيسية')
  expect(flat).toContain('فاتورة جديدة')

  // Verify the rendered text is actual Arabic, not mojibake. A mojibake string
  // typically contains Latin-1 range chars where Arabic glyphs should be.
  for (const t of navTexts.filter((s) => s.trim())) {
    if (hasArabic(t)) {
      // Each char should be Arabic or whitespace/punctuation - not Latin alphabet
      expect(/[A-Za-z]{3,}/.test(t), `mojibake suspected in "${t}"`).toBe(false)
    }
  }

  // Navigate to New Invoice and screenshot the form in Arabic
  await window.locator('a[href="/invoice/new"], a[href="#/invoice/new"]').first().click()
  await window.waitForSelector('h1', { timeout: 5000 })
  await window.waitForTimeout(300)
  await window.screenshot({ path: join(SCREENSHOT_DIR, '03-ar-new-invoice.png'), fullPage: true })

  // The page heading should be the Arabic "فاتورة جديدة"
  const pageH1 = await window.locator('h1').first().textContent()
  expect(pageH1?.trim()).toBe('فاتورة جديدة')

  // Switch back to English and verify
  await langButton.click()
  await window.waitForFunction(() => document.documentElement.dir === 'ltr', { timeout: 3000 })
  await window.waitForTimeout(300)
  await window.screenshot({ path: join(SCREENSHOT_DIR, '04-en-new-invoice.png'), fullPage: true })
  const englishH1 = await window.locator('h1').first().textContent()
  expect(englishH1?.trim()).toBe('New Invoice')

  await app.close()
})
