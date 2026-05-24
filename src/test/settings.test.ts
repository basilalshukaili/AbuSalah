import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'

import { getAllSettings, updateSettings } from '@main/db/settings-repo'
import { db } from '@main/db/connection'
import { settingsTable } from '@main/db/schema'

import { setupTestDb, teardownTestDb } from './setup'

describe('settings-repo', () => {
  let dbFile: string

  beforeEach(async () => {
    dbFile = await setupTestDb()
  })

  afterEach(() => {
    teardownTestDb(dbFile)
  })

  describe('getAllSettings', () => {
    it('returns the bootstrapped DEFAULTS on a fresh DB', async () => {
      const s = await getAllSettings()
      expect(s.taxRate).toBe(0.05)
      expect(s.currency).toBe('OMR')
      expect(s.currencyDecimals).toBe(3)
      expect(s.lowStockDefault).toBe(10)
      expect(s.language).toBe('en')
      expect(s.theme).toBe('light')
      expect(s.fontSize).toBe(18)
      expect(s.businessName).toBe('Abu Salah Projects')
      expect(s.businessNameAr).toBe('مشاريع ابو صلاح')
      expect(s.autoBackup).toBe(true)
      expect(s.backupKeepDays).toBe(30)
    })

    it('falls back to DEFAULTS for keys missing from the database', async () => {
      // Simulate a partial settings table by deleting one row
      await db().delete(settingsTable).where(eq(settingsTable.key, 'language')).run()
      const s = await getAllSettings()
      expect(s.language).toBe('en')
    })
  })

  describe('updateSettings', () => {
    it('round-trips multiple field types correctly', async () => {
      await updateSettings({
        language: 'ar',
        theme: 'dark',
        taxRate: 0.1,
        autoBackup: false
      })
      const s = await getAllSettings()
      expect(s.language).toBe('ar')
      expect(s.theme).toBe('dark')
      expect(s.taxRate).toBe(0.1)
      expect(s.autoBackup).toBe(false)
    })

    it('coerces boolean true → "1" in storage', async () => {
      await updateSettings({ autoBackup: true })
      const row = await db()
        .select()
        .from(settingsTable)
        .where(eq(settingsTable.key, 'autoBackup'))
        .get()
      expect(row?.value).toBe('1')
    })

    it('coerces boolean false → "0" in storage', async () => {
      await updateSettings({ autoBackup: false })
      const row = await db()
        .select()
        .from(settingsTable)
        .where(eq(settingsTable.key, 'autoBackup'))
        .get()
      expect(row?.value).toBe('0')
    })

    it('preserves untouched settings when patching a single key', async () => {
      const original = await getAllSettings()
      await updateSettings({ language: 'ar' })
      const after = await getAllSettings()
      expect(after.language).toBe('ar')
      expect(after.currency).toBe(original.currency)
      expect(after.taxRate).toBe(original.taxRate)
      expect(after.theme).toBe(original.theme)
    })

    it('numeric fields are coerced back to numbers on read', async () => {
      await updateSettings({ taxRate: 0.075, fontSize: 22, backupKeepDays: 60 })
      const s = await getAllSettings()
      expect(typeof s.taxRate).toBe('number')
      expect(s.taxRate).toBe(0.075)
      expect(typeof s.fontSize).toBe('number')
      expect(s.fontSize).toBe(22)
      expect(typeof s.backupKeepDays).toBe('number')
      expect(s.backupKeepDays).toBe(60)
    })

    it('returns the fully-resolved settings object', async () => {
      const next = await updateSettings({ language: 'ar', theme: 'dark' })
      expect(next.language).toBe('ar')
      expect(next.theme).toBe('dark')
      // Other defaults still present
      expect(next.currency).toBe('OMR')
    })

    it('skips undefined values in the patch', async () => {
      await updateSettings({ language: 'ar' })
      // Now patch with explicit undefined — should not erase
      await updateSettings({ language: undefined, theme: 'dark' })
      const s = await getAllSettings()
      expect(s.language).toBe('ar')
      expect(s.theme).toBe('dark')
    })

    it('persists Arabic strings (e.g. businessNameAr)', async () => {
      const newName = 'الشركة الجديدة'
      await updateSettings({ businessNameAr: newName })
      const s = await getAllSettings()
      expect(s.businessNameAr).toBe(newName)
    })
  })
})
