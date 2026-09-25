import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'node:http'
import { networkInterfaces } from 'node:os'
import { dirname, extname, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'

import type { MobileAccessInfo } from '@shared/types'
import * as invoices from '../domain/invoices'
import { getAllSettings } from '../db/settings-repo'
import { exportSalesExcel } from '../services/excel-export'
import { renderInvoicePdf } from '../services/pdf-service'
import {
  invokeOperation,
  reportRangeSchema,
  RpcInputError,
  RpcMethodNotFoundError
} from '../api/operations'

const DEFAULT_PORT = 47_831
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000
const MAX_JSON_BYTES = 256 * 1_024
const SESSION_COOKIE = 'abusalah_session'

export interface LanServerOptions {
  rendererDir: string
  exportDir: string
  appVersion: string
  port?: number
  /** Production should keep 0.0.0.0; loopback is useful for integration tests. */
  host?: string
  sessionTtlMs?: number
  /** Defaults beside the exports directory. Only token hashes are persisted. */
  sessionStatePath?: string
  /** Supplied by Electron integration; must print silently to the PC default printer. */
  printInvoice?: (invoiceId: number) => Promise<void>
}

export interface LanServerHandle {
  getInfo: () => MobileAccessInfo
  rotatePin: () => MobileAccessInfo
  close: () => Promise<void>
}

interface Session {
  expiresAt: number
}

interface PersistedSessionState {
  version: 1
  pin: string
  sessions: Array<{ tokenHash: string; expiresAt: number }>
}

interface WindowCounter {
  startedAt: number
  count: number
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

class FixedWindowLimiter {
  private readonly counters = new Map<string, WindowCounter>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  allow(key: string): boolean {
    const now = Date.now()
    const current = this.counters.get(key)
    if (!current || now - current.startedAt >= this.windowMs) {
      this.counters.set(key, { startedAt: now, count: 1 })
      this.compact(now)
      return true
    }
    current.count += 1
    return current.count <= this.limit
  }

  reset(key: string): void {
    this.counters.delete(key)
  }

  private compact(now: number): void {
    if (this.counters.size < 1_000) return
    for (const [key, counter] of this.counters) {
      if (now - counter.startedAt >= this.windowMs) this.counters.delete(key)
    }
  }
}

function createPin(previous?: string): string {
  let next = ''
  do {
    next = String(randomInt(0, 1_000_000)).padStart(6, '0')
  } while (next === previous)
  return next
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function parseIpv4(address: string): number | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  let result = 0
  for (const raw of parts) {
    if (!/^\d{1,3}$/.test(raw)) return null
    const value = Number(raw)
    if (value < 0 || value > 255) return null
    result = ((result << 8) | value) >>> 0
  }
  return result >>> 0
}

function isPrivateIpv4(address: string): boolean {
  const value = parseIpv4(address)
  if (value === null) return false
  const first = value >>> 24
  const second = (value >>> 16) & 0xff
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}

function privateInterfaces(): Array<{ address: string; mask: number }> {
  const result: Array<{ address: string; mask: number }> = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const info of entries ?? []) {
      if (info.internal || info.family !== 'IPv4' || !isPrivateIpv4(info.address)) continue
      const mask = parseIpv4(info.netmask)
      if (mask !== null) result.push({ address: info.address, mask })
    }
  }
  return result
}

function normalizeRemoteAddress(address: string | undefined): string {
  if (!address) return ''
  const withoutZone = address.split('%', 1)[0]
  return withoutZone.startsWith('::ffff:') ? withoutZone.slice(7) : withoutZone
}

function isLoopback(address: string): boolean {
  return address === '::1' || address === '127.0.0.1'
}

/** Allow loopback or an IPv4 peer on one of this PC's current private subnets. */
function isLocalPrivatePeer(address: string): boolean {
  if (isLoopback(address)) return true
  const remote = parseIpv4(address)
  if (remote === null || !isPrivateIpv4(address)) return false
  return privateInterfaces().some(({ address: localAddress, mask }) => {
    const local = parseIpv4(localAddress)
    return local !== null && ((remote & mask) >>> 0) === ((local & mask) >>> 0)
  })
}

function allowedHost(host: string | undefined, port: number): boolean {
  if (!host || host.includes('/') || host.includes('\\')) return false
  const normalized = host.toLowerCase()
  const allowed = new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
    ...privateInterfaces().map(({ address }) => `${address}:${port}`)
  ])
  return allowed.has(normalized)
}

function requireSameOrigin(req: IncomingMessage): void {
  const host = req.headers.host
  const origin = req.headers.origin
  if (!host || !origin) throw new HttpError(403, 'BAD_ORIGIN', 'Request origin is not allowed')
  try {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'http:' || parsed.host.toLowerCase() !== host.toLowerCase()) {
      throw new Error('origin mismatch')
    }
  } catch {
    throw new HttpError(403, 'BAD_ORIGIN', 'Request origin is not allowed')
  }
}

function securityHeaders(res: ServerResponse): void {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'"
  ].join('; '))
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
}

function sendJson(
  res: ServerResponse,
  status: number,
  value: unknown,
  extraHeaders: Record<string, string> = {}
): void {
  const body = Buffer.from(JSON.stringify(value))
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': String(body.length),
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders
  })
  res.end(body)
}

function sendApiError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { ok: false, error: { code, message } })
}

async function readJson(req: IncomingMessage, maxBytes = MAX_JSON_BYTES): Promise<unknown> {
  const contentType = req.headers['content-type'] ?? ''
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'JSON_REQUIRED', 'Content-Type must be application/json')
  }
  const declared = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body is too large')
  }

  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += bytes.length
    if (total > maxBytes) throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body is too large')
    chunks.push(bytes)
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body is not valid JSON')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseCookies(raw: string | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  for (const part of (raw ?? '').split(';')) {
    const separator = part.indexOf('=')
    if (separator <= 0) continue
    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (key) result[key] = value
  }
  return result
}

function tokenFromRequest(req: IncomingMessage): string | null {
  const auth = req.headers.authorization
  const bearer = auth?.match(/^Bearer ([A-Za-z0-9_-]{32,128})$/)
  if (bearer) return bearer[1]
  return parseCookies(req.headers.cookie)[SESSION_COOKIE] ?? null
}

function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAgeSeconds}`
}

function expiredSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0`
}

function safeOperationMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'The operation failed'
  return raw.replace(/[\r\n]+/g, ' ').slice(0, 500)
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

async function regularFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function staticPath(rendererRoot: string, pathname: string, accept: string): Promise<string> {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    throw new HttpError(400, 'BAD_PATH', 'Invalid URL path')
  }
  if (decoded.includes('\0') || decoded.includes('\\')) {
    throw new HttpError(400, 'BAD_PATH', 'Invalid URL path')
  }
  const parts = decoded.split('/').filter(Boolean)
  if (parts.some((part) => part === '..')) throw new HttpError(400, 'BAD_PATH', 'Invalid URL path')

  const root = resolve(rendererRoot)
  const candidate = resolve(root, ...(parts.length ? parts : ['index.html']))
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    throw new HttpError(400, 'BAD_PATH', 'Invalid URL path')
  }
  if (await regularFile(candidate)) return candidate

  // The current app uses HashRouter, but this fallback also keeps direct SPA
  // routes working if it later moves to BrowserRouter.
  if (accept.includes('text/html')) {
    const index = resolve(root, 'index.html')
    if (await regularFile(index)) return index
  }
  throw new HttpError(404, 'NOT_FOUND', 'File not found')
}

async function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  contentType: string,
  disposition?: string,
  removeAfter = false
): Promise<void> {
  try {
    const info = await stat(path)
    const headers: Record<string, string> = {
      'Content-Length': String(info.size),
      'Content-Type': contentType
    }
    if (disposition) headers['Content-Disposition'] = disposition
    res.writeHead(200, headers)
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    await pipeline(createReadStream(path), res)
  } finally {
    if (removeAfter) await unlink(path).catch(() => undefined)
  }
}

function requestAddress(req: IncomingMessage): string {
  return normalizeRemoteAddress(req.socket.remoteAddress)
}

export async function startLanServer(options: LanServerOptions): Promise<LanServerHandle> {
  const requestedPort = options.port ?? DEFAULT_PORT
  const host = options.host ?? '0.0.0.0'
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS
  const sessionStatePath =
    options.sessionStatePath ?? resolve(options.exportDir, '..', 'lan-access-sessions.json')
  const sessions = new Map<string, Session>()
  const requestLimiter = new FixedWindowLimiter(300, 60_000)
  const loginLimiter = new FixedWindowLimiter(5, 10 * 60_000)
  const printLimiter = new FixedWindowLimiter(10, 60_000)
  let pin = createPin()
  let actualPort = requestedPort
  let persistTail: Promise<void> = Promise.resolve()

  try {
    const saved = JSON.parse(await readFile(sessionStatePath, 'utf8')) as Partial<PersistedSessionState>
    if (saved.version === 1 && Array.isArray(saved.sessions)) {
      if (typeof saved.pin === 'string' && /^\d{6}$/.test(saved.pin)) pin = saved.pin
      const now = Date.now()
      for (const entry of saved.sessions) {
        if (
          entry &&
          /^[a-f0-9]{64}$/.test(entry.tokenHash) &&
          Number.isFinite(entry.expiresAt) &&
          entry.expiresAt > now
        ) {
          sessions.set(entry.tokenHash, { expiresAt: entry.expiresAt })
        }
      }
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') console.warn('Could not load LAN session state:', error)
  }

  const persistSessions = (): void => {
    persistTail = persistTail
      .then(async () => {
        const state: PersistedSessionState = {
          version: 1,
          pin,
          sessions: [...sessions].map(([hash, session]) => ({
            tokenHash: hash,
            expiresAt: session.expiresAt
          }))
        }
        await mkdir(dirname(sessionStatePath), { recursive: true })
        const temporary = `${sessionStatePath}.${process.pid}.${randomUUID()}.tmp`
        await writeFile(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 })
        try {
          await rename(temporary, sessionStatePath)
        } catch {
          // Windows does not always replace an existing destination atomically.
          await rm(sessionStatePath, { force: true })
          await rename(temporary, sessionStatePath)
        }
      })
      .catch((error) => console.warn('Could not persist LAN session state:', error))
  }

  // Create/upgrade the local state file immediately so the pairing PIN and
  // surviving sessions remain stable across normal app restarts.
  persistSessions()

  const pruneSessions = (): void => {
    const now = Date.now()
    let changed = false
    for (const [token, session] of sessions) {
      if (session.expiresAt <= now) {
        sessions.delete(token)
        changed = true
      }
    }
    if (changed) persistSessions()
  }

  const authenticate = (req: IncomingMessage): string => {
    pruneSessions()
    const token = tokenFromRequest(req)
    const hash = token ? tokenHash(token) : ''
    const session = token ? sessions.get(hash) : undefined
    if (!token || !session || session.expiresAt <= Date.now()) {
      if (hash && sessions.delete(hash)) persistSessions()
      throw new HttpError(401, 'AUTH_REQUIRED', 'Pair this phone with the desktop app')
    }
    return token
  }

  const handleApi = async (
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    remoteAddress: string
  ): Promise<void> => {
    const method = req.method ?? 'GET'

    if (url.pathname === '/api/status' && method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        service: 'Abu Salah LAN',
        protocolVersion: 1,
        authRequired: true,
        appVersion: options.appVersion
      })
      return
    }

    if (url.pathname === '/api/auth/login' && method === 'POST') {
      requireSameOrigin(req)
      if (!loginLimiter.allow(remoteAddress)) {
        throw new HttpError(429, 'RATE_LIMITED', 'Too many pairing attempts; try again later')
      }
      const body = await readJson(req, 1_024)
      const suppliedPin = isRecord(body) && typeof body.pin === 'string' ? body.pin : ''
      if (!/^\d{6}$/.test(suppliedPin) || !constantTimeEqual(suppliedPin, pin)) {
        throw new HttpError(401, 'INVALID_PIN', 'The pairing PIN is incorrect')
      }

      loginLimiter.reset(remoteAddress)
      const token = randomBytes(32).toString('base64url')
      const expiresAt = Date.now() + sessionTtlMs
      sessions.set(tokenHash(token), { expiresAt })
      persistSessions()
      sendJson(
        res,
        200,
        { ok: true, token, expiresAt: new Date(expiresAt).toISOString() },
        { 'Set-Cookie': sessionCookie(token, Math.floor(sessionTtlMs / 1_000)) }
      )
      return
    }

    if (url.pathname === '/api/auth/session' && method === 'GET') {
      const token = authenticate(req)
      const session = sessions.get(tokenHash(token))!
      sendJson(res, 200, {
        ok: true,
        token,
        expiresAt: new Date(session.expiresAt).toISOString()
      })
      return
    }

    if (url.pathname === '/api/auth/logout' && method === 'POST') {
      requireSameOrigin(req)
      const token = authenticate(req)
      sessions.delete(tokenHash(token))
      persistSessions()
      sendJson(res, 200, { ok: true }, { 'Set-Cookie': expiredSessionCookie() })
      return
    }

    const printMatch = url.pathname.match(/^\/api\/invoices\/(\d+)\/print$/)
    if (printMatch && method === 'POST') {
      requireSameOrigin(req)
      authenticate(req)
      if (!printLimiter.allow(remoteAddress)) {
        throw new HttpError(429, 'RATE_LIMITED', 'Too many print requests')
      }
      if (!options.printInvoice) {
        throw new HttpError(501, 'PRINT_UNAVAILABLE', 'PC printing is not configured')
      }
      const invoiceId = Number(printMatch[1])
      if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) {
        throw new HttpError(400, 'INVALID_ID', 'Invalid invoice id')
      }
      if (!(await invoices.getById(invoiceId))) {
        throw new HttpError(404, 'NOT_FOUND', 'Invoice not found')
      }
      try {
        await options.printInvoice(invoiceId)
      } catch (error) {
        throw new HttpError(409, 'PRINT_FAILED', safeOperationMessage(error))
      }
      sendJson(res, 200, { ok: true })
      return
    }

    if (url.pathname === '/api/rpc' && method === 'POST') {
      requireSameOrigin(req)
      authenticate(req)
      const body = await readJson(req)
      if (
        !isRecord(body) ||
        typeof body.method !== 'string' ||
        body.method.length > 100 ||
        !Array.isArray(body.args)
      ) {
        throw new HttpError(400, 'INVALID_RPC', 'Expected { method, args }')
      }

      try {
        const result = await invokeOperation(body.method, body.args)
        sendJson(res, 200, { ok: true, result: result ?? null })
      } catch (error) {
        if (error instanceof RpcMethodNotFoundError) {
          sendApiError(res, 404, error.code, error.message)
        } else if (error instanceof RpcInputError) {
          sendApiError(res, 400, error.code, error.message)
        } else {
          sendApiError(res, 409, 'OPERATION_FAILED', safeOperationMessage(error))
        }
      }
      return
    }

    const pdfMatch = url.pathname.match(/^\/api\/invoices\/(\d+)\/pdf$/)
    if (pdfMatch && method === 'GET') {
      authenticate(req)
      const invoiceId = Number(pdfMatch[1])
      if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) {
        throw new HttpError(400, 'INVALID_ID', 'Invalid invoice id')
      }
      const invoice = await invoices.getById(invoiceId)
      if (!invoice) throw new HttpError(404, 'NOT_FOUND', 'Invoice not found')
      const settings = await getAllSettings()
      await mkdir(options.exportDir, { recursive: true })
      const target = resolve(options.exportDir, `.lan-invoice-${invoiceId}-${randomUUID()}.pdf`)
      await renderInvoicePdf(invoice, settings, settings.language, target)
      await sendFile(
        req,
        res,
        target,
        'application/pdf',
        `inline; filename="invoice_${invoice.number}.pdf"`,
        true
      )
      return
    }

    if (url.pathname === '/api/reports/sales.xlsx' && method === 'GET') {
      authenticate(req)
      const parsed = reportRangeSchema.safeParse({
        start: url.searchParams.get('start'),
        end: url.searchParams.get('end')
      })
      if (!parsed.success) throw new HttpError(400, 'INVALID_RANGE', 'Invalid report date range')
      await mkdir(options.exportDir, { recursive: true })
      const target = resolve(options.exportDir, `.lan-sales-${randomUUID()}.xlsx`)
      await exportSalesExcel(parsed.data, target)
      await sendFile(
        req,
        res,
        target,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        `attachment; filename="sales_${parsed.data.start.slice(0, 10)}_${parsed.data.end.slice(0, 10)}.xlsx"`,
        true
      )
      return
    }

    throw new HttpError(404, 'NOT_FOUND', 'API endpoint not found')
  }

  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    securityHeaders(res)
    const remoteAddress = requestAddress(req)
    try {
      if (!isLocalPrivatePeer(remoteAddress)) {
        throw new HttpError(403, 'PRIVATE_NETWORK_ONLY', 'LAN access is limited to the local network')
      }
      if (!requestLimiter.allow(remoteAddress)) {
        throw new HttpError(429, 'RATE_LIMITED', 'Too many requests')
      }
      if (!allowedHost(req.headers.host, actualPort)) {
        throw new HttpError(421, 'BAD_HOST', 'Request host is not allowed')
      }

      const hostHeader = req.headers.host!
      const url = new URL(req.url ?? '/', `http://${hostHeader}`)
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url, remoteAddress)
        return
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
      }
      const path = await staticPath(
        options.rendererDir,
        url.pathname,
        String(req.headers.accept ?? '')
      )
      const contentType = MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
      res.setHeader(
        'Cache-Control',
        extname(path).toLowerCase() === '.html' ? 'no-store' : 'public, max-age=3600'
      )
      await sendFile(req, res, path, contentType)
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : undefined)
        return
      }
      if (error instanceof HttpError) {
        sendApiError(res, error.status, error.code, error.message)
      } else {
        console.error('LAN server request failed:', error)
        sendApiError(res, 500, 'INTERNAL_ERROR', 'The server could not complete the request')
      }
    }
  }

  const server: Server = createServer((req, res) => {
    void handleRequest(req, res)
  })
  server.headersTimeout = 10_000
  server.requestTimeout = 30_000
  server.keepAliveTimeout = 5_000
  server.maxHeadersCount = 50
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
  })

  await new Promise<void>((resolveStart, rejectStart) => {
    const onError = (error: Error): void => rejectStart(error)
    server.once('error', onError)
    server.listen(requestedPort, host, () => {
      server.off('error', onError)
      resolveStart()
    })
  })

  const boundAddress = server.address()
  if (!boundAddress || typeof boundAddress === 'string') {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
    throw new Error('LAN server did not expose a TCP address')
  }
  actualPort = boundAddress.port

  const getInfo = (): MobileAccessInfo => {
    pruneSessions()
    return {
      enabled: true,
      port: actualPort,
      urls: privateInterfaces().map(
        ({ address }) => `http://${address}:${actualPort}/?key=${encodeURIComponent(pin)}`
      ),
      pin,
      sessionCount: sessions.size
    }
  }

  return {
    getInfo,
    rotatePin: () => {
      pin = createPin(pin)
      sessions.clear()
      persistSessions()
      return getInfo()
    },
    close: async () => {
      persistSessions()
      await persistTail
      server.closeIdleConnections?.()
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()))
      })
    }
  }
}
