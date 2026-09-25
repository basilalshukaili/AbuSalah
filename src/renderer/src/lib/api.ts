import type {
  Customer,
  CustomerInput,
  Invoice,
  InvoiceInput,
  InvoiceStatus,
  IpcApi,
  KPISummary,
  MobileAccessInfo,
  Product,
  ProductInput,
  SalesByDay,
  SalesByMonth,
  Settings,
  TopCustomer,
  TopProduct
} from '@shared/types'

const TOKEN_KEY = 'abu-salah-mobile-token'
const TOKEN_EXPIRY_KEY = 'abu-salah-mobile-token-expiry'

interface SuccessEnvelope<T> {
  ok: true
  result: T
}

interface ErrorEnvelope {
  ok: false
  error: {
    code: string
    message: string
  }
}

interface LoginEnvelope {
  ok: true
  token: string
  expiresAt: string
}

interface ActionEnvelope {
  ok: true
}

interface StatusEnvelope {
  ok: true
  service: 'Abu Salah LAN'
  protocolVersion: 1
  authRequired: true
  appVersion?: string
}

export type MobileAuthStatus =
  | 'desktop'
  | 'checking'
  | 'authenticated'
  | 'needs-pin'
  | 'offline'

export interface MobileAuthSnapshot {
  status: MobileAuthStatus
  message?: string
}

export class MobileApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status = 0, code = 'UNKNOWN') {
    super(message)
    this.name = 'MobileApiError'
    this.status = status
    this.code = code
  }
}

const nativeApi = typeof window !== 'undefined' ? window.api : undefined

export const isMobileBrowser = !nativeApi

let authSnapshot: MobileAuthSnapshot = isMobileBrowser
  ? { status: 'checking' }
  : { status: 'desktop' }

const authListeners = new Set<() => void>()

function publishAuth(next: MobileAuthSnapshot): void {
  authSnapshot = next
  for (const listener of authListeners) listener()
}

export function getMobileAuthSnapshot(): MobileAuthSnapshot {
  return authSnapshot
}

export function subscribeMobileAuth(listener: () => void): () => void {
  authListeners.add(listener)
  return () => authListeners.delete(listener)
}

function readToken(): string | null {
  if (!isMobileBrowser) return null

  const token = window.sessionStorage.getItem(TOKEN_KEY)
  const expiry = window.sessionStorage.getItem(TOKEN_EXPIRY_KEY)
  if (!token) return null

  if (expiry && Date.parse(expiry) <= Date.now()) {
    clearToken()
    return null
  }
  return token
}

function saveToken(token: string, expiresAt: string): void {
  window.sessionStorage.setItem(TOKEN_KEY, token)
  window.sessionStorage.setItem(TOKEN_EXPIRY_KEY, expiresAt)
}

function clearToken(): void {
  if (!isMobileBrowser) return
  window.sessionStorage.removeItem(TOKEN_KEY)
  window.sessionStorage.removeItem(TOKEN_EXPIRY_KEY)
}

function errorFromEnvelope(
  response: Response,
  envelope: ErrorEnvelope | null,
  fallback: string
): MobileApiError {
  return new MobileApiError(
    envelope?.error.message || fallback,
    response.status,
    envelope?.error.code || `HTTP_${response.status}`
  )
}

async function parseJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T
  } catch {
    return null
  }
}

async function publicStatus(): Promise<StatusEnvelope> {
  const response = await fetch('/api/status', {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' }
  })
  const payload = await parseJson<StatusEnvelope | ErrorEnvelope>(response)

  if (!response.ok || !payload || !payload.ok) {
    throw errorFromEnvelope(
      response,
      payload && !payload.ok ? payload : null,
      'The Abu Salah service is unavailable.'
    )
  }
  if (payload.service !== 'Abu Salah LAN' || payload.protocolVersion !== 1) {
    throw new MobileApiError('This server uses an unsupported Abu Salah protocol.', 409, 'PROTOCOL')
  }
  return payload
}

async function recoverMobileSession(): Promise<void> {
  const response = await fetch('/api/auth/session', {
    method: 'GET',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(readToken() ? { Authorization: `Bearer ${readToken()}` } : {})
    }
  })
  const payload = await parseJson<LoginEnvelope | ErrorEnvelope>(response)
  if (!response.ok || !payload || !payload.ok) {
    throw errorFromEnvelope(
      response,
      payload && !payload.ok ? payload : null,
      'Open the one-click link shown on the PC.'
    )
  }
  saveToken(payload.token, payload.expiresAt)
}

function authHeaders(): Record<string, string> {
  const token = readToken()
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  }
}

async function rpc<T>(method: string, args: unknown[] = []): Promise<T> {
  let response: Response
  try {
    response = await fetch('/api/rpc', {
      method: 'POST',
      credentials: 'same-origin',
      headers: authHeaders(),
      body: JSON.stringify({ method, args })
    })
  } catch {
    publishAuth({
      status: 'offline',
      message: 'The PC cannot be reached. Check that Abu Salah is open and both devices use the same Wi-Fi.'
    })
    throw new MobileApiError('The Abu Salah PC cannot be reached.', 0, 'NETWORK')
  }

  const payload = await parseJson<SuccessEnvelope<T> | ErrorEnvelope>(response)
  if (!response.ok || !payload || !payload.ok) {
    if (response.status === 401 || response.status === 403) {
      clearToken()
      publishAuth({ status: 'needs-pin', message: 'Your mobile session expired. Enter the PIN again.' })
    }
    throw errorFromEnvelope(
      response,
      payload && !payload.ok ? payload : null,
      `Request ${method} failed.`
    )
  }
  return payload.result
}

export async function initializeMobileAuth(): Promise<void> {
  if (!isMobileBrowser) return

  publishAuth({ status: 'checking' })
  try {
    await publicStatus()
    const oneClickKey = new URLSearchParams(window.location.search).get('key')
    if (oneClickKey) {
      // The desktop deliberately puts the short-lived pairing secret in its
      // displayed LAN URL. Exchange it immediately, then erase it from browser
      // history/address-bar while retaining the HashRouter route.
      try {
        await mobileLogin(oneClickKey)
        return
      } finally {
        const cleanUrl = `${window.location.pathname}${window.location.hash}`
        window.history.replaceState(window.history.state, '', cleanUrl)
      }
    }

    // Recover a bearer token from the HttpOnly cookie after a tab/browser
    // restart, or validate the bearer token already in sessionStorage.
    await recoverMobileSession()
    publishAuth({ status: 'authenticated' })
  } catch (error) {
    if (error instanceof MobileApiError && (error.status === 401 || error.status === 403)) {
      clearToken()
      publishAuth({ status: 'needs-pin', message: error.message })
      return
    }
    publishAuth({
      status: 'offline',
      message:
        error instanceof Error
          ? error.message
          : 'The PC cannot be reached. Check the Wi-Fi connection.'
    })
  }
}

export async function mobileLogin(pin: string): Promise<void> {
  if (!isMobileBrowser) return

  const normalizedPin = pin.trim()
  if (!/^\d{6}$/.test(normalizedPin)) {
    throw new MobileApiError('Enter the numeric PIN shown on the PC.', 400, 'INVALID_PIN_FORMAT')
  }

  let response: Response
  try {
    response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ pin: normalizedPin })
    })
  } catch {
    publishAuth({ status: 'offline', message: 'The Abu Salah PC cannot be reached.' })
    throw new MobileApiError('The Abu Salah PC cannot be reached.', 0, 'NETWORK')
  }

  const payload = await parseJson<LoginEnvelope | ErrorEnvelope>(response)
  if (!response.ok || !payload || !payload.ok) {
    const error = errorFromEnvelope(
      response,
      payload && !payload.ok ? payload : null,
      response.status === 429 ? 'Too many attempts. Wait and try again.' : 'The PIN is not correct.'
    )
    publishAuth({ status: 'needs-pin', message: error.message })
    throw error
  }

  saveToken(payload.token, payload.expiresAt)
  publishAuth({ status: 'authenticated' })
}

export async function mobileLogout(): Promise<void> {
  if (!isMobileBrowser) return

  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: authHeaders(),
      body: '{}'
    })
  } finally {
    clearToken()
    publishAuth({ status: 'needs-pin' })
  }
}

function desktopOnly<T>(): Promise<T> {
  return Promise.reject(
    new MobileApiError('This action is available only in the Windows app.', 403, 'DESKTOP_ONLY')
  )
}

function filenameFromDisposition(response: Response, fallback: string): string {
  const disposition = response.headers.get('content-disposition') ?? ''
  const match = disposition.match(/filename="?([^";]+)"?/i)
  return match?.[1] || fallback
}

async function downloadFile(path: string, fallbackName: string, openInline = false): Promise<string> {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        Accept: openInline ? 'application/pdf' : '*/*',
        ...(readToken() ? { Authorization: `Bearer ${readToken()}` } : {})
      }
    })
  } catch {
    publishAuth({ status: 'offline', message: 'The Abu Salah PC cannot be reached.' })
    throw new MobileApiError('The Abu Salah PC cannot be reached.', 0, 'NETWORK')
  }

  if (!response.ok) {
    const payload = await parseJson<ErrorEnvelope>(response)
    if (response.status === 401 || response.status === 403) {
      clearToken()
      publishAuth({ status: 'needs-pin', message: 'Your mobile session expired. Enter the PIN again.' })
    }
    throw errorFromEnvelope(response, payload && !payload.ok ? payload : null, 'Download failed.')
  }

  const filename = filenameFromDisposition(response, fallbackName)
  const objectUrl = URL.createObjectURL(await response.blob())
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.rel = 'noopener'
  if (openInline) anchor.target = '_blank'
  else anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
  return filename
}

async function authenticatedPost(path: string): Promise<void> {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(readToken() ? { Authorization: `Bearer ${readToken()}` } : {})
      }
    })
  } catch {
    publishAuth({ status: 'offline', message: 'The Abu Salah PC cannot be reached.' })
    throw new MobileApiError('The Abu Salah PC cannot be reached.', 0, 'NETWORK')
  }

  const payload = await parseJson<ActionEnvelope | ErrorEnvelope>(response)
  if (!response.ok || !payload || !payload.ok) {
    if (response.status === 401 || response.status === 403) {
      clearToken()
      publishAuth({ status: 'needs-pin', message: 'Your mobile session expired. Open the link shown on the PC again.' })
    }
    throw errorFromEnvelope(
      response,
      payload && !payload.ok ? payload : null,
      'The PC could not print this invoice.'
    )
  }
}

function createBrowserApi(): IpcApi {
  return {
    settingsGetAll: () => rpc<Settings>('settingsGetAll'),
    settingsUpdate: (patch) => rpc<Settings>('settingsUpdate', [patch]),

    customersList: (term) => rpc<Customer[]>('customersList', [term ?? '']),
    customersGet: (id) => rpc<Customer | null>('customersGet', [id]),
    customersUpsert: (input: CustomerInput) => rpc<Customer>('customersUpsert', [input]),
    customersUpdate: (id, patch: Partial<CustomerInput>) =>
      rpc<Customer>('customersUpdate', [id, patch]),
    customersDelete: (id) => rpc<void>('customersDelete', [id]),
    customerOutstanding: (id) => rpc<number>('customerOutstanding', [id]),

    productsList: (opts) => rpc<Product[]>('productsList', [opts ?? {}]),
    productsGet: (id) => rpc<Product | null>('productsGet', [id]),
    productsCreate: (input: ProductInput) => rpc<Product>('productsCreate', [input]),
    productsUpdate: (id, patch: Partial<ProductInput>) =>
      rpc<Product>('productsUpdate', [id, patch]),
    productsDelete: (id) => rpc<void>('productsDelete', [id]),
    productsRestock: (id, qty, reason) => rpc<Product>('productsRestock', [id, qty, reason]),

    invoicesCreate: (input: InvoiceInput) => rpc<Invoice>('invoicesCreate', [input]),
    invoicesGet: (id) => rpc<Invoice | null>('invoicesGet', [id]),
    invoicesGetByNumber: (no) => rpc<Invoice | null>('invoicesGetByNumber', [no]),
    invoicesSearch: (filter: {
      term?: string
      dateFrom?: string
      dateTo?: string
      status?: InvoiceStatus | ''
      limit?: number
    }) => rpc<Invoice[]>('invoicesSearch', [filter]),
    invoicesVoid: (id, reason) => rpc<Invoice>('invoicesVoid', [id, reason]),
    invoicesRecordPayment: (id, amount) =>
      rpc<Invoice>('invoicesRecordPayment', [id, amount]),

    reportsKpis: (range) => rpc<KPISummary>('reportsKpis', [range]),
    reportsSalesByDay: (range) => rpc<SalesByDay[]>('reportsSalesByDay', [range]),
    reportsSalesByMonth: (range) => rpc<SalesByMonth[]>('reportsSalesByMonth', [range]),
    reportsTopProducts: (range, limit) =>
      rpc<TopProduct[]>('reportsTopProducts', [range, limit ?? 20]),
    reportsTopCustomers: (range, limit) =>
      rpc<TopCustomer[]>('reportsTopCustomers', [range, limit ?? 20]),
    reportsExportExcel: (range) => {
      const query = new URLSearchParams({ start: range.start, end: range.end })
      return downloadFile(`/api/reports/sales.xlsx?${query.toString()}`, 'sales.xlsx')
    },

    invoiceRenderPdf: (id) =>
      downloadFile(`/api/invoices/${id}/pdf`, `invoice_${id}.pdf`, true),
    invoicePrint: (id) => authenticatedPost(`/api/invoices/${id}/print`),

    // Filesystem administration is deliberately unavailable through the phone UI.
    backupCreate: () => desktopOnly<string>(),
    backupList: () => desktopOnly<{ path: string; size: number; mtime: string }[]>(),
    backupRestore: () => desktopOnly<void>(),
    legacyImport: () => desktopOnly<{ products: number; invoices: number; customers: number }>(),
    legacyHasFiles: () => desktopOnly<boolean>(),

    appVersion: async () => (await publicStatus()).appVersion ?? '2.0.0',
    appReload: () => desktopOnly<void>(),
    mobileAccessInfo: () => desktopOnly<MobileAccessInfo>(),
    mobileAccessRotatePin: () => desktopOnly<MobileAccessInfo>()
  }
}

if (isMobileBrowser) {
  // Keep all existing routes unchanged: their window.api calls use HTTP in a
  // browser and the contextBridge implementation inside Electron.
  window.api = createBrowserApi()
}

export const api: IpcApi = window.api
