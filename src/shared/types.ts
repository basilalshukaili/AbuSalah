/**
 * Types shared between the Electron main process and the React renderer.
 *
 * The IPC contract is also expressed in this file so that both ends use
 * the same TypeScript signatures.
 */

export type DocumentType = 'invoice' | 'quotation' | 'receipt'
export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'void'
export type PaymentMethod = 'cash' | 'card' | 'bank' | 'credit'
export type Theme = 'light' | 'dark'
export type Language = 'en' | 'ar'

// ---------- Domain DTOs ----------

export interface Customer {
  id: number
  name: string     // Arabic name
  nameEn: string   // English name
  phone: string
  address: string
  email: string
  notes: string
  createdAt: string
  updatedAt: string
}

export interface Product {
  id: number
  code: string
  name: string
  nameAr: string
  unit: string
  price: number
  cost: number
  qty: number
  lowStockThreshold: number
  category: string
  notes: string
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface InvoiceItem {
  id: number
  invoiceId: number
  productId: number | null
  code: string
  nameSnapshot: string
  qty: number
  unitPrice: number
  extraPrice: number
  lineTotal: number
}

export interface Invoice {
  id: number
  number: number
  customerId: number | null
  date: string
  subtotal: number
  discount: number
  taxRate: number
  taxAmount: number
  total: number
  advance: number
  balance: number
  paymentMethod: PaymentMethod
  status: InvoiceStatus
  documentType: DocumentType
  notes: string
  voidedAt: string | null
  voidedReason: string
  createdAt: string
  updatedAt: string
  // joined fields:
  customerName: string   // Arabic name
  customerNameEn: string // English name
  customerPhone: string
  items: InvoiceItem[]
}

// ---------- Inputs ----------

export interface InvoiceLineInput {
  productId: number | null
  code: string
  name: string
  qty: number
  unitPrice: number
  extraPrice: number
}

export interface InvoiceInput {
  customerName: string   // Arabic name
  customerNameEn: string // English name
  customerPhone: string
  items: InvoiceLineInput[]
  discount: number
  advance: number
  taxRate?: number
  paymentMethod: PaymentMethod
  notes: string
  documentType: DocumentType
}

export interface ProductInput {
  code: string
  name: string
  nameAr: string
  unit: string
  price: number
  cost: number
  qty: number
  lowStockThreshold: number
  category: string
  notes: string
}

export interface CustomerInput {
  name: string   // Arabic name
  nameEn: string // English name
  phone: string
  address: string
  email: string
  notes: string
}

// ---------- Reports ----------

export interface KPISummary {
  invoiceCount: number
  totalSales: number
  totalAdvance: number
  totalBalance: number
  totalTax: number
  start: string
  end: string
}

export interface SalesByDay {
  day: string
  invoices: number
  total: number
}

export interface SalesByMonth {
  month: string
  invoices: number
  total: number
}

export interface TopProduct {
  name: string
  qty: number
  total: number
}

export interface TopCustomer {
  id: number
  name: string
  phone: string
  invoices: number
  total: number
}

// ---------- Settings ----------

export interface Settings {
  taxRate: number
  currency: string
  currencyDecimals: number
  lowStockDefault: number
  language: Language
  theme: Theme
  fontSize: number
  businessName: string
  businessNameAr: string
  businessPhone: string
  businessAddress: string
  businessEmail: string
  autoBackup: boolean
  backupKeepDays: number
}

// ---------- IPC contract ----------

export interface IpcApi {
  // Settings
  settingsGetAll: () => Promise<Settings>
  settingsUpdate: (patch: Partial<Settings>) => Promise<Settings>

  // Customers
  customersList: (term?: string) => Promise<Customer[]>
  customersGet: (id: number) => Promise<Customer | null>
  customersUpsert: (input: CustomerInput) => Promise<Customer>
  customersUpdate: (id: number, patch: Partial<CustomerInput>) => Promise<Customer>
  customersDelete: (id: number) => Promise<void>
  customerOutstanding: (id: number) => Promise<number>

  // Products
  productsList: (opts?: { term?: string; lowStockOnly?: boolean; activeOnly?: boolean }) => Promise<Product[]>
  productsGet: (id: number) => Promise<Product | null>
  productsCreate: (input: ProductInput) => Promise<Product>
  productsUpdate: (id: number, patch: Partial<ProductInput>) => Promise<Product>
  productsDelete: (id: number) => Promise<void>
  productsRestock: (id: number, qty: number, reason: string) => Promise<Product>

  // Invoices
  invoicesCreate: (input: InvoiceInput) => Promise<Invoice>
  invoicesGet: (id: number) => Promise<Invoice | null>
  invoicesGetByNumber: (no: number) => Promise<Invoice | null>
  invoicesSearch: (filter: {
    term?: string
    dateFrom?: string
    dateTo?: string
    status?: InvoiceStatus | ''
    limit?: number
  }) => Promise<Invoice[]>
  invoicesVoid: (id: number, reason: string) => Promise<Invoice>
  invoicesRecordPayment: (id: number, amount: number) => Promise<Invoice>

  // Reports
  reportsKpis: (range: { start: string; end: string }) => Promise<KPISummary>
  reportsSalesByDay: (range: { start: string; end: string }) => Promise<SalesByDay[]>
  reportsSalesByMonth: (range: { start: string; end: string }) => Promise<SalesByMonth[]>
  reportsTopProducts: (range: { start: string; end: string }, limit?: number) => Promise<TopProduct[]>
  reportsTopCustomers: (range: { start: string; end: string }, limit?: number) => Promise<TopCustomer[]>
  reportsExportExcel: (range: { start: string; end: string }, target?: string) => Promise<string>

  // PDF & Print
  invoiceRenderPdf: (id: number, target?: string) => Promise<string>
  invoicePrint: (id: number) => Promise<void>

  // Backup
  backupCreate: (label?: string) => Promise<string>
  backupList: () => Promise<{ path: string; size: number; mtime: string }[]>
  backupRestore: (path: string) => Promise<void>

  // Legacy import
  legacyImport: () => Promise<{ products: number; invoices: number; customers: number }>
  legacyHasFiles: () => Promise<boolean>

  // App
  appVersion: () => Promise<string>
  appReload: () => Promise<void>
}

// Helper to type the global window
export interface WindowApi {
  api: IpcApi
}

declare global {
  interface Window extends WindowApi {}
}
