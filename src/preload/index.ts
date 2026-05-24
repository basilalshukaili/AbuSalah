import { contextBridge, ipcRenderer } from 'electron'

import type { IpcApi } from '@shared/types'

const api: IpcApi = {
  // Settings
  settingsGetAll: () => ipcRenderer.invoke('settings:getAll'),
  settingsUpdate: (patch) => ipcRenderer.invoke('settings:update', patch),

  // Customers
  customersList: (term) => ipcRenderer.invoke('customers:list', term ?? ''),
  customersGet: (id) => ipcRenderer.invoke('customers:get', id),
  customersUpsert: (input) => ipcRenderer.invoke('customers:upsert', input),
  customersUpdate: (id, patch) => ipcRenderer.invoke('customers:update', id, patch),
  customersDelete: (id) => ipcRenderer.invoke('customers:delete', id),
  customerOutstanding: (id) => ipcRenderer.invoke('customers:outstanding', id),

  // Products
  productsList: (opts) => ipcRenderer.invoke('products:list', opts ?? {}),
  productsGet: (id) => ipcRenderer.invoke('products:get', id),
  productsCreate: (input) => ipcRenderer.invoke('products:create', input),
  productsUpdate: (id, patch) => ipcRenderer.invoke('products:update', id, patch),
  productsDelete: (id) => ipcRenderer.invoke('products:delete', id),
  productsRestock: (id, qty, reason) => ipcRenderer.invoke('products:restock', id, qty, reason),

  // Invoices
  invoicesCreate: (input) => ipcRenderer.invoke('invoices:create', input),
  invoicesGet: (id) => ipcRenderer.invoke('invoices:get', id),
  invoicesGetByNumber: (no) => ipcRenderer.invoke('invoices:getByNumber', no),
  invoicesSearch: (filter) => ipcRenderer.invoke('invoices:search', filter ?? {}),
  invoicesVoid: (id, reason) => ipcRenderer.invoke('invoices:void', id, reason),
  invoicesRecordPayment: (id, amount) => ipcRenderer.invoke('invoices:recordPayment', id, amount),

  // Reports
  reportsKpis: (range) => ipcRenderer.invoke('reports:kpis', range),
  reportsSalesByDay: (range) => ipcRenderer.invoke('reports:salesByDay', range),
  reportsSalesByMonth: (range) => ipcRenderer.invoke('reports:salesByMonth', range),
  reportsTopProducts: (range, limit) => ipcRenderer.invoke('reports:topProducts', range, limit),
  reportsTopCustomers: (range, limit) => ipcRenderer.invoke('reports:topCustomers', range, limit),
  reportsExportExcel: (range, target) => ipcRenderer.invoke('reports:exportExcel', range, target),

  // PDF
  invoiceRenderPdf: (id, target) => ipcRenderer.invoke('invoice:renderPdf', id, target),
  invoicePrint: (id) => ipcRenderer.invoke('invoice:print', id),

  // Backup
  backupCreate: (label) => ipcRenderer.invoke('backup:create', label ?? ''),
  backupList: () => ipcRenderer.invoke('backup:list'),
  backupRestore: (path) => ipcRenderer.invoke('backup:restore', path),

  // Legacy
  legacyHasFiles: () => ipcRenderer.invoke('legacy:hasFiles'),
  legacyImport: () => ipcRenderer.invoke('legacy:import'),

  // App
  appVersion: () => ipcRenderer.invoke('app:version'),
  appReload: () => ipcRenderer.invoke('app:reload')
}

contextBridge.exposeInMainWorld('api', api)
