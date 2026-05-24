import { eq } from 'drizzle-orm'

import type { Language, Settings, Theme } from '@shared/types'
import { db } from './connection'
import { settingsTable } from './schema'

const DEFAULTS: Record<keyof Settings, string> = {
  taxRate: '0.05',
  currency: 'OMR',
  currencyDecimals: '3',
  lowStockDefault: '10',
  language: 'en',
  theme: 'light',
  fontSize: '18',
  businessName: 'Abu Salah Projects',
  businessNameAr: 'مشاريع ابو صلاح',
  businessPhone: '',
  businessAddress: '',
  businessEmail: '',
  autoBackup: '1',
  backupKeepDays: '30'
}

async function getRaw(key: string): Promise<string | null> {
  const row = await db().select().from(settingsTable).where(eq(settingsTable.key, key)).get()
  return row?.value ?? null
}

async function setRaw(key: string, value: string): Promise<void> {
  const exists = (await getRaw(key)) !== null
  if (exists) {
    await db().update(settingsTable).set({ value }).where(eq(settingsTable.key, key)).run()
  } else {
    await db().insert(settingsTable).values({ key, value }).run()
  }
}

export async function getAllSettings(): Promise<Settings> {
  const out: Record<string, string> = {}
  const rows = await db().select().from(settingsTable).all()
  for (const r of rows) out[r.key] = r.value
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (out[k] === undefined) out[k] = v
  }

  return {
    taxRate: Number(out.taxRate ?? '0.05'),
    currency: out.currency ?? 'OMR',
    currencyDecimals: Number(out.currencyDecimals ?? '3'),
    lowStockDefault: Number(out.lowStockDefault ?? '10'),
    language: ((out.language ?? 'en') as Language),
    theme: ((out.theme ?? 'light') as Theme),
    fontSize: Number(out.fontSize ?? '18'),
    businessName: out.businessName ?? '',
    businessNameAr: out.businessNameAr ?? '',
    businessPhone: out.businessPhone ?? '',
    businessAddress: out.businessAddress ?? '',
    businessEmail: out.businessEmail ?? '',
    autoBackup: out.autoBackup === '1' || out.autoBackup === 'true',
    backupKeepDays: Number(out.backupKeepDays ?? '30')
  }
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    let stored: string
    if (typeof v === 'boolean') stored = v ? '1' : '0'
    else stored = String(v)
    await setRaw(k, stored)
  }
  return getAllSettings()
}
