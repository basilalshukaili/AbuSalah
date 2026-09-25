import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('records a later payment and marks an unpaid invoice paid at phone width', async () => {
  const userData = join(tmpdir(), `abusalah-payment-${Date.now()}`)
  if (existsSync(userData)) rmSync(userData, { recursive: true, force: true })

  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })

  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForSelector('h1', { timeout: 15_000 })

    const invoice = await window.evaluate(async () => {
      const product = await window.api.productsCreate({
        code: 'PAY-TEST',
        name: 'Payment test item',
        nameAr: '',
        unit: 'pc',
        price: 10,
        cost: 0,
        qty: 5,
        lowStockThreshold: 0,
        category: '',
        notes: ''
      })
      return window.api.invoicesCreate({
        customerName: 'Payment test customer',
        customerNameEn: '',
        customerPhone: '90000001',
        items: [
          {
            productId: product.id,
            code: product.code,
            name: product.name,
            qty: 1,
            unitPrice: 10,
            extraPrice: 0
          }
        ],
        discount: 0,
        advance: 0,
        taxRate: 0,
        paymentMethod: 'cash',
        notes: '',
        documentType: 'invoice'
      })
    })

    await window.setViewportSize({ width: 390, height: 844 })
    await window.evaluate(() => {
      window.location.hash = '#/search'
    })
    await expect(
      window.getByRole('heading', { name: 'Search Invoices' })
    ).toBeVisible()

    await window.getByRole('button', { name: `#${invoice.number}` }).click()
    await window.getByRole('button', { name: 'Record Payment' }).click()

    const amount = window.locator('#payment-amount')
    await expect(amount).toHaveValue('10.000')
    await window.getByRole('button', { name: 'Record Payment' }).click()

    await expect(
      window.getByText(
        `Payment of 10.000 OMR recorded for invoice #${invoice.number}.`
      )
    ).toBeVisible()
    await expect(window.getByText('Paid', { exact: true })).toBeVisible()
    await expect(window.getByText('0.000 OMR', { exact: true })).toBeVisible()
    await expect(
      window.getByRole('button', { name: 'Record Payment' })
    ).toHaveCount(0)
    const updated = await window.evaluate(
      (id) => window.api.invoicesGet(id),
      invoice.id
    )
    expect(updated?.status).toBe('paid')
    expect(updated?.balance).toBe(0)
  } finally {
    await app.close()
    if (existsSync(userData)) rmSync(userData, { recursive: true, force: true })
  }
})
