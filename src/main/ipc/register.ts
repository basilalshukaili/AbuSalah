/**
 * Register all IPC handlers. The renderer never imports anything from
 * `@main/*` directly — it talks to this layer via the preload script,
 * which is in turn typed by `IpcApi` in `@shared/types`.
 */

import { app, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'

import * as customers from '../domain/customers'
import * as products from '../domain/products'
import * as invoices from '../domain/invoices'
import * as reports from '../domain/reports'
import { getAllSettings, updateSettings } from '../db/settings-repo'
import {
  createBackup,
  cleanupOld,
  listBackups,
  restoreBackup
} from '../services/backup-service'
import { closeDatabase, configureDatabase, dbPath, defaultDbPath } from '../db/connection'
import { bootstrapSchema } from '../db/bootstrap'
import { importAll } from '../services/legacy-import'
import { renderInvoicePdf } from '../services/pdf-service'
import { exportSalesExcel } from '../services/excel-export'

import { existsSync, mkdirSync, statSync } from 'node:fs'

let _backupDir = ''
let _exportDir = ''

export function paths(userDataDir: string): {
  data: string
  backups: string
  exports: string
  legacyBills: string
  legacyItems: string
} {
  const root = userDataDir
  // Legacy folders are placed next to the user-data dir under "AbuSalahLegacy"
  // so they survive an `app.asar` packaged build. Operators are also able to
  // pick a custom path through the Settings UI (see `legacy:importFrom`).
  const legacyRoot = process.env.ABU_LEGACY_DIR ?? join(root, '..', 'AbuSalahLegacy')
  const dirs = {
    data: join(root, 'data'),
    backups: join(root, 'backups'),
    exports: join(root, 'exports'),
    legacyBills: join(legacyRoot, 'bills'),
    legacyItems: join(legacyRoot, 'items')
  }
  for (const p of [dirs.data, dirs.backups, dirs.exports]) {
    if (!existsSync(p)) mkdirSync(p, { recursive: true })
  }
  return dirs
}

export async function configurePathsAndDb(userDataDir: string): Promise<void> {
  const dirs = paths(userDataDir)
  _backupDir = dirs.backups
  _exportDir = dirs.exports
  await configureDatabase(defaultDbPath(userDataDir))
  await bootstrapSchema()
}

export function registerIpc(): void {
  // ---------- Settings ----------
  ipcMain.handle('settings:getAll', async () => await getAllSettings())
  ipcMain.handle('settings:update', async (_e, patch) => await updateSettings(patch))

  // ---------- Customers ----------
  ipcMain.handle('customers:list', async (_e, term) => customers.search(term ?? ''))
  ipcMain.handle('customers:get', async (_e, id) => customers.getById(Number(id)))
  ipcMain.handle('customers:upsert', async (_e, input) => customers.upsertByPhone(input))
  ipcMain.handle('customers:update', async (_e, id, patch) => customers.update(Number(id), patch))
  ipcMain.handle('customers:delete', async (_e, id) => customers.remove(Number(id)))
  ipcMain.handle('customers:outstanding', async (_e, id) => customers.outstandingBalance(Number(id)))

  // ---------- Products ----------
  ipcMain.handle('products:list', async (_e, opts) => products.list(opts ?? {}))
  ipcMain.handle('products:get', async (_e, id) => products.getById(Number(id)))
  ipcMain.handle('products:create', async (_e, input) => products.create(input))
  ipcMain.handle('products:update', async (_e, id, patch) => products.update(Number(id), patch))
  ipcMain.handle('products:delete', async (_e, id) => products.softDelete(Number(id)))
  ipcMain.handle('products:restock', async (_e, id, qty, reason) =>
    products.restock(Number(id), Number(qty), reason ?? '')
  )

  // ---------- Invoices ----------
  ipcMain.handle('invoices:create', async (_e, input) => {
    // Inject default tax rate from settings if absent
    if (input.taxRate === undefined) {
      const s = await getAllSettings()
      input.taxRate = s.taxRate
    }
    return invoices.create(input)
  })
  ipcMain.handle('invoices:get', async (_e, id) => invoices.getById(Number(id)))
  ipcMain.handle('invoices:getByNumber', async (_e, no) => invoices.getByNumber(Number(no)))
  ipcMain.handle('invoices:search', async (_e, filter) => invoices.search(filter ?? {}))
  ipcMain.handle('invoices:void', async (_e, id, reason) => invoices.voidInvoice(Number(id), reason ?? ''))
  ipcMain.handle('invoices:recordPayment', async (_e, id, amount) =>
    invoices.recordPayment(Number(id), Number(amount))
  )

  // ---------- Reports ----------
  ipcMain.handle('reports:kpis', async (_e, range) => reports.kpis(range ?? {}))
  ipcMain.handle('reports:salesByDay', async (_e, range) => reports.salesByDay(range ?? {}))
  ipcMain.handle('reports:salesByMonth', async (_e, range) => reports.salesByMonth(range ?? {}))
  ipcMain.handle('reports:topProducts', async (_e, range, limit) =>
    reports.topProducts(range ?? {}, limit)
  )
  ipcMain.handle('reports:topCustomers', async (_e, range, limit) =>
    reports.topCustomers(range ?? {}, limit)
  )
  ipcMain.handle('reports:exportExcel', async (_e, range, target) => {
    const out = target ?? join(_exportDir, `sales_${(range?.start ?? '').slice(0, 10)}_${(range?.end ?? '').slice(0, 10)}.xlsx`)
    return exportSalesExcel(range ?? {}, out)
  })

  // ---------- PDF & Print ----------
  ipcMain.handle('invoice:renderPdf', async (_e, id, target) => {
    const inv = await invoices.getById(Number(id))
    if (!inv) throw new Error(`invoice ${id} not found`)
    const settings = await getAllSettings()
    const dest = target ?? join(_exportDir, `invoice_${inv.number}.pdf`)
    return renderInvoicePdf(inv, settings, settings.language, dest)
  })
  ipcMain.handle('invoice:print', async (_e, id) => {
    const inv = await invoices.getById(Number(id))
    if (!inv) throw new Error(`invoice ${id} not found`)
    const settings = await getAllSettings()
    const dest = join(_exportDir, `invoice_${inv.number}.pdf`)
    await renderInvoicePdf(inv, settings, settings.language, dest)
    await shell.openPath(dest)
  })

  // ---------- Backup ----------
  ipcMain.handle('backup:create', async (_e, label) => createBackup(_backupDir, label ?? ''))
  ipcMain.handle('backup:list', async () => listBackups(_backupDir))
  ipcMain.handle('backup:restore', async (_e, p) => {
    restoreBackup(p, _backupDir)
    closeDatabase()
    await configureDatabase(dbPath())
    await bootstrapSchema()
  })

  // ---------- Legacy import ----------
  ipcMain.handle('legacy:hasFiles', async () => {
    const dirs = paths(app.getPath('userData'))
    try {
      return statSync(dirs.legacyBills).isDirectory() || statSync(dirs.legacyItems).isDirectory()
    } catch {
      return false
    }
  })
  ipcMain.handle('legacy:import', async () => {
    const dirs = paths(app.getPath('userData'))
    return importAll({ itemsDir: dirs.legacyItems, billsDir: dirs.legacyBills })
  })

  // ---------- App ----------
  ipcMain.handle('app:version', async () => app.getVersion())
  ipcMain.handle('app:reload', async () => {
    const { BrowserWindow } = await import('electron')
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.reload())
  })
}

export async function autoBackupOnStart(): Promise<void> {
  try {
    const settings = await getAllSettings()
    if (!settings.autoBackup) return
    createBackup(_backupDir, 'auto')
    cleanupOld(_backupDir, settings.backupKeepDays)
  } catch (err) {
    console.warn('autoBackup failed:', err)
  }
}
