import { _electron as electron, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'e2e', 'screenshots')
mkdirSync(DIR, { recursive: true })

test('debug: capture initial page', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, NODE_ENV: 'development' }
  })

  // Capture all console messages from the main process and renderer
  app.on('console', (msg) => console.log('[main]', msg.type(), msg.text()))

  const window = await app.firstWindow()
  window.on('console', (msg) => console.log('[renderer]', msg.type(), msg.text()))
  window.on('pageerror', (err) => console.log('[pageerror]', err.message))

  // Wait for the page to settle
  await window.waitForLoadState('domcontentloaded')
  await window.waitForTimeout(5000)

  // Dump the body content
  const html = await window.evaluate(() => document.body.innerHTML.slice(0, 4000))
  console.log('[body]', html)

  const dir = await window.evaluate(() => document.documentElement.dir)
  console.log('[doc.dir]', dir)

  const url = window.url()
  console.log('[url]', url)

  await window.screenshot({ path: join(DIR, 'debug-initial.png'), fullPage: true })

  await app.close()
})
