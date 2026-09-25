/**
 * Remote-safe business operation registry.
 *
 * Method names deliberately match IpcApi so the renderer can swap between an
 * Electron preload transport and an HTTP transport without changing screens.
 * Only operations in this literal allowlist can be invoked over the LAN.
 * Desktop-only capabilities such as backup restore, legacy import, app reload,
 * arbitrary output paths, and shell printing are intentionally absent.
 */
import { z } from 'zod'

import packageJson from '../../../package.json'
import * as customers from '../domain/customers'
import * as invoices from '../domain/invoices'
import * as products from '../domain/products'
import * as reports from '../domain/reports'
import { getAllSettings, updateSettings } from '../db/settings-repo'
import { enqueueMutation } from './mutation-queue'

export class RpcInputError extends Error {
  readonly code = 'INVALID_ARGUMENTS'

  constructor(message: string) {
    super(message)
    this.name = 'RpcInputError'
  }
}

export class RpcMethodNotFoundError extends Error {
  readonly code = 'METHOD_NOT_FOUND'

  constructor(method: string) {
    super(`RPC method is not available: ${method}`)
    this.name = 'RpcMethodNotFoundError'
  }
}

interface RemoteOperation {
  readonly mutates: boolean
  readonly schema: z.ZodTypeAny
  readonly invoke: (args: unknown[]) => Promise<unknown>
}

type TupleOutput<TSchema extends z.ZodTypeAny> = z.output<TSchema> extends unknown[]
  ? z.output<TSchema>
  : never

function defineOperation<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  mutates: boolean,
  invoke: (...args: TupleOutput<TSchema>) => Promise<unknown>
): RemoteOperation {
  return {
    schema,
    mutates,
    invoke: (args) => invoke(...(args as TupleOutput<TSchema>))
  }
}

const shortText = z.string().max(500)
const longText = z.string().max(5_000)
const id = z.number().int().positive()
const finite = z.number().finite()
const nonNegative = finite.min(0)
const positive = finite.positive()
const dateLike = z
  .string()
  .max(40)
  .regex(/^\d{4}-\d{2}-\d{2}(?:T.*)?$/, 'expected an ISO date or timestamp')

const settingsPatchSchema = z
  .object({
    taxRate: finite.min(0).max(1),
    currency: z.string().min(1).max(12),
    currencyDecimals: z.number().int().min(0).max(6),
    lowStockDefault: nonNegative,
    language: z.enum(['en', 'ar']),
    theme: z.enum(['light', 'dark']),
    fontSize: z.number().int().min(12).max(32),
    businessName: shortText,
    businessNameAr: shortText,
    businessPhone: z.string().max(50),
    businessAddress: longText,
    businessEmail: z.string().max(254),
    autoBackup: z.boolean(),
    backupKeepDays: z.number().int().min(1).max(3_650)
  })
  .partial()
  .strict()

const customerInputSchema = z
  .object({
    name: shortText,
    nameEn: shortText,
    phone: z.string().trim().min(1).max(50),
    address: longText,
    email: z.string().max(254),
    notes: longText
  })
  .strict()

const customerPatchSchema = customerInputSchema.partial().strict()

const productInputSchema = z
  .object({
    code: z.string().max(100),
    name: z.string().trim().min(1).max(500),
    nameAr: shortText,
    unit: z.string().max(50),
    price: nonNegative,
    cost: nonNegative,
    qty: nonNegative,
    lowStockThreshold: nonNegative,
    category: shortText,
    notes: longText
  })
  .strict()

const productPatchSchema = productInputSchema.partial().strict()

const invoiceLineSchema = z
  .object({
    productId: id.nullable(),
    code: z.string().max(100),
    name: z.string().trim().min(1).max(500),
    qty: positive,
    unitPrice: nonNegative,
    extraPrice: nonNegative
  })
  .strict()

const invoiceInputSchema = z
  .object({
    customerName: shortText,
    customerNameEn: shortText,
    customerPhone: z.string().max(50),
    items: z.array(invoiceLineSchema).min(1).max(500),
    discount: nonNegative,
    advance: nonNegative,
    taxRate: finite.min(0).max(1).optional(),
    paymentMethod: z.enum(['cash', 'card', 'bank', 'credit']),
    notes: longText,
    documentType: z.enum(['invoice', 'quotation', 'receipt'])
  })
  .strict()

const productListOptionsSchema = z
  .object({
    term: z.string().max(200).optional(),
    lowStockOnly: z.boolean().optional(),
    activeOnly: z.boolean().optional()
  })
  .strict()

const invoiceSearchSchema = z
  .object({
    term: z.string().max(200).optional(),
    dateFrom: dateLike.optional(),
    dateTo: dateLike.optional(),
    status: z.enum(['unpaid', 'partial', 'paid', 'void', '']).optional(),
    limit: z.number().int().min(1).max(500).optional()
  })
  .strict()

export const reportRangeSchema = z
  .object({
    start: dateLike,
    end: dateLike
  })
  .strict()

const remoteOperations = {
  settingsGetAll: defineOperation(z.tuple([]), false, async () => getAllSettings()),
  settingsUpdate: defineOperation(z.tuple([settingsPatchSchema]), true, async (patch) =>
    updateSettings(patch)
  ),

  customersList: defineOperation(
    z.tuple([z.string().max(200).nullish()]),
    false,
    async (term) => customers.search(term ?? '')
  ),
  customersGet: defineOperation(z.tuple([id]), false, async (customerId) =>
    customers.getById(customerId)
  ),
  customersUpsert: defineOperation(z.tuple([customerInputSchema]), true, async (input) =>
    customers.upsertByPhone(input)
  ),
  customersUpdate: defineOperation(
    z.tuple([id, customerPatchSchema]),
    true,
    async (customerId, patch) => customers.update(customerId, patch)
  ),
  customersDelete: defineOperation(z.tuple([id]), true, async (customerId) => {
    await customers.remove(customerId)
    return null
  }),
  customerOutstanding: defineOperation(z.tuple([id]), false, async (customerId) =>
    customers.outstandingBalance(customerId)
  ),

  productsList: defineOperation(
    z.tuple([productListOptionsSchema.nullish()]),
    false,
    async (options) => products.list(options ?? {})
  ),
  productsGet: defineOperation(z.tuple([id]), false, async (productId) =>
    products.getById(productId)
  ),
  productsCreate: defineOperation(z.tuple([productInputSchema]), true, async (input) =>
    products.create(input)
  ),
  productsUpdate: defineOperation(
    z.tuple([id, productPatchSchema]),
    true,
    async (productId, patch) => products.update(productId, patch)
  ),
  productsDelete: defineOperation(z.tuple([id]), true, async (productId) => {
    await products.softDelete(productId)
    return null
  }),
  productsRestock: defineOperation(
    z.tuple([id, positive, z.string().max(500)]),
    true,
    async (productId, qty, reason) => products.restock(productId, qty, reason)
  ),

  invoicesCreate: defineOperation(z.tuple([invoiceInputSchema]), true, async (rawInput) => {
    const input = { ...rawInput }
    if (input.taxRate === undefined) {
      input.taxRate = (await getAllSettings()).taxRate
    }
    return invoices.create(input)
  }),
  invoicesGet: defineOperation(z.tuple([id]), false, async (invoiceId) =>
    invoices.getById(invoiceId)
  ),
  invoicesGetByNumber: defineOperation(
    z.tuple([z.number().int().positive()]),
    false,
    async (invoiceNumber) => invoices.getByNumber(invoiceNumber)
  ),
  invoicesSearch: defineOperation(
    z.tuple([invoiceSearchSchema.nullish()]),
    false,
    async (filter) => invoices.search(filter ?? {})
  ),
  invoicesVoid: defineOperation(
    z.tuple([id, z.string().max(2_000)]),
    true,
    async (invoiceId, reason) => invoices.voidInvoice(invoiceId, reason)
  ),
  invoicesRecordPayment: defineOperation(
    z.tuple([id, positive]),
    true,
    async (invoiceId, amount) => invoices.recordPayment(invoiceId, amount)
  ),

  reportsKpis: defineOperation(z.tuple([reportRangeSchema]), false, async (range) =>
    reports.kpis(range)
  ),
  reportsSalesByDay: defineOperation(z.tuple([reportRangeSchema]), false, async (range) =>
    reports.salesByDay(range)
  ),
  reportsSalesByMonth: defineOperation(z.tuple([reportRangeSchema]), false, async (range) =>
    reports.salesByMonth(range)
  ),
  reportsTopProducts: defineOperation(
    z.tuple([reportRangeSchema, z.number().int().min(1).max(100).nullish()]),
    false,
    async (range, limit) => reports.topProducts(range, limit ?? undefined)
  ),
  reportsTopCustomers: defineOperation(
    z.tuple([reportRangeSchema, z.number().int().min(1).max(100).nullish()]),
    false,
    async (range, limit) => reports.topCustomers(range, limit ?? undefined)
  ),

  appVersion: defineOperation(z.tuple([]), false, async () => packageJson.version)
} as const satisfies Record<string, RemoteOperation>

export type RemoteMethodName = keyof typeof remoteOperations

export const REMOTE_METHOD_NAMES = Object.freeze(
  Object.keys(remoteOperations) as RemoteMethodName[]
)

export function isRemoteMethodName(value: string): value is RemoteMethodName {
  return Object.prototype.hasOwnProperty.call(remoteOperations, value)
}

export async function invokeOperation(method: string, args: unknown[]): Promise<unknown> {
  if (!isRemoteMethodName(method)) throw new RpcMethodNotFoundError(method)

  const operation = remoteOperations[method]
  const parsed = operation.schema.safeParse(args)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || 'args'}: ${issue.message}`)
      .join('; ')
    throw new RpcInputError(detail || 'invalid RPC arguments')
  }

  const run = () => operation.invoke(parsed.data as unknown[])
  return operation.mutates ? enqueueMutation(run) : run()
}
