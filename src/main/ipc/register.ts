/**
 * Register all IPC handlers. The renderer never imports anything from
 * `@main/*` directly — it talks to this layer via the preload script,
 * which is in turn typed by `IpcApi` in `@shared/types`.
 */

import { app, dialog, ipcMain } from 'electron'
import { join } from 'node:path'

import * as invoices from '../domain/invoices'
import { getAllSettings } from '../db/settings-repo'
import {
  createBackup,
  cleanupOld,
  listBackups,
  restoreBackup
} from '../services/backup-service'
import { checkpointWal, closeDatabase, configureDatabase, dbPath, defaultDbPath } from '../db/connection'
import { bootstrapSchema } from '../db/bootstrap'
import { importAll } from '../services/legacy-import'
import { printInvoiceSilently, renderInvoicePdf } from '../services/pdf-service'
import { exportSalesExcel } from '../services/excel-export'
import { invokeOperation, type RemoteMethodName } from '../api/operations'
import { enqueueMutation } from '../api/mutation-queue'
import type { LanServerHandle } from '../http/lan-server'
import type { MobileAccessInfo } from '@shared/types'

import { existsSync, mkdirSync, statSync } from 'node:fs'
import packageJson from '../../../package.json'

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

export async function printInvoiceById(id: number): Promise<void> {
  const inv = await invoices.getById(Number(id))
  if (!inv) throw new Error(`Invoice ${id} was not found. / لم يتم العثور على الفاتورة.`)
  const settings = await getAllSettings()
  await printInvoiceSilently(inv, settings)
}

export function registerIpc(lanServer: LanServerHandle | null): void {
  // The Electron UI and phone UI use the same validated operation dispatcher,
  // including one shared mutation queue for invoice-number safety.
  const registerOperation = (channel: string, method: RemoteMethodName): void => {
    ipcMain.handle(channel, async (_event, ...args: unknown[]) => invokeOperation(method, args))
  }

  registerOperation('settings:getAll', 'settingsGetAll')
  registerOperation('settings:update', 'settingsUpdate')
  registerOperation('customers:list', 'customersList')
  registerOperation('customers:get', 'customersGet')
  registerOperation('customers:upsert', 'customersUpsert')
  registerOperation('customers:update', 'customersUpdate')
  registerOperation('customers:delete', 'customersDelete')
  registerOperation('customers:outstanding', 'customerOutstanding')
  registerOperation('products:list', 'productsList')
  registerOperation('products:get', 'productsGet')
  registerOperation('products:create', 'productsCreate')
  registerOperation('products:update', 'productsUpdate')
  registerOperation('products:delete', 'productsDelete')
  registerOperation('products:restock', 'productsRestock')
  registerOperation('invoices:create', 'invoicesCreate')
  registerOperation('invoices:get', 'invoicesGet')
  registerOperation('invoices:getByNumber', 'invoicesGetByNumber')
  registerOperation('invoices:search', 'invoicesSearch')
  registerOperation('invoices:void', 'invoicesVoid')
  registerOperation('invoices:recordPayment', 'invoicesRecordPayment')
  registerOperation('reports:kpis', 'reportsKpis')
  registerOperation('reports:salesByDay', 'reportsSalesByDay')
  registerOperation('reports:salesByMonth', 'reportsSalesByMonth')
  registerOperation('reports:topProducts', 'reportsTopProducts')
  registerOperation('reports:topCustomers', 'reportsTopCustomers')

  // ---------- Reports ----------
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
    await printInvoiceById(Number(id))
  })

  // ---------- Backup ----------
  ipcMain.handle('backup:create', async (_e, label) => enqueueMutation(async () => {
    await checkpointWal() // flush WAL so the copy contains the latest data
    return createBackup(_backupDir, label ?? '')
  }))
  ipcMain.handle('backup:list', async () => listBackups(_backupDir))
  ipcMain.handle('backup:restore', async (_e, p) => enqueueMutation(async () => {
    await checkpointWal() // ensure the pre_restore snapshot is complete
    restoreBackup(p, _backupDir)
    closeDatabase()
    await configureDatabase(dbPath())
    await bootstrapSchema()
  }))

  // ---------- Legacy import ----------
  ipcMain.handle('legacy:hasFiles', async () => {
    const dirs = paths(app.getPath('userData'))
    try {
      return statSync(dirs.legacyBills).isDirectory() || statSync(dirs.legacyItems).isDirectory()
    } catch {
      return false
    }
  })
  ipcMain.handle('legacy:import', async () => enqueueMutation(async () => {
    const dirs = paths(app.getPath('userData'))
    return importAll({ itemsDir: dirs.legacyItems, billsDir: dirs.legacyBills })
  }))

  // ---------- App ----------
  const disabledMobileInfo = (): MobileAccessInfo => ({
    enabled: false,
    port: 47_831,
    urls: [],
    pin: '',
    sessionCount: 0
  })
  ipcMain.handle('mobile:info', async () => lanServer?.getInfo() ?? disabledMobileInfo())
  ipcMain.handle('mobile:rotatePin', async () => lanServer?.rotatePin() ?? disabledMobileInfo())
  ipcMain.handle('app:version', async () => packageJson.version)
  ipcMain.handle('app:reload', async () => {
    const { BrowserWindow } = await import('electron')
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.reload())
  })
}

export async function autoBackupOnStart(): Promise<void> {
  try {
    const settings = await getAllSettings()
    if (!settings.autoBackup) return
    await checkpointWal() // flush WAL so the backup contains the latest data
    createBackup(_backupDir, 'auto')
    cleanupOld(_backupDir, settings.backupKeepDays)
  } catch (err) {
    console.warn('autoBackup failed:', err)
    // The owner relies on daily backups — surface a failure (e.g. disk full)
    // instead of letting it fail silently.
    try {
      dialog.showMessageBox({
        type: 'warning',
        title: 'النسخ الاحتياطي / Backup',
        message: 'فشل النسخ الاحتياطي التلقائي\nAutomatic backup failed',
        detail:
          (err instanceof Error ? err.message : String(err)) +
          '\n\nقد تكون مساحة القرص ممتلئة — الرجاء إخلاء مساحة.\nThe disk may be full — please free up space.'
      })
    } catch {
      // dialog unavailable (very early startup) — already logged above
    }
  }
}
