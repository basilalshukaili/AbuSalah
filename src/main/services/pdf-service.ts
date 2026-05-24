/**
 * Generates an invoice PDF by rendering a fully HTML-designed bill
 * that mirrors the abu.jpg template layout.
 *
 * Structure (top → bottom):
 *   Header  : EN address | Logo + brand name | AR address
 *   Blue bar
 *   Invoice row : NO | فاتورة نقدية/على الحساب | Date
 *   Customer row
 *   Items table (bilingual columns)
 *   Watermark logo (background)
 *   Totals box + notes
 *   Blue bar + email
 *   Terms & conditions
 *   Signature row
 */

import { BrowserWindow, app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Invoice, Settings } from '@shared/types'
import { formatMoney, hasArabic } from '@shared/formatting'

// ─── asset helpers ────────────────────────────────────────────────────────────

function findAsset(filename: string): string {
  const base = app.getAppPath()
  const candidates = [
    join(base, 'resources', filename),          // packaged: asar root/resources
    join(base, '..', 'resources', filename),    // packaged: app.asar/../resources
    join(base, '..', '..', 'resources', filename), // dev: out/main/../../resources
    join(process.resourcesPath ?? '', filename)  // production extraResources
  ]
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c
    } catch { /* ignore */ }
  }
  return ''
}

type AssetCache = { regular: string; bold: string; logo: string }
let _assets: AssetCache | null = null

function assets(): AssetCache {
  if (_assets) return _assets
  const enc = (p: string, mime = 'font/ttf') =>
    p ? `data:${mime};base64,${readFileSync(p).toString('base64')}` : ''

  const base = app.getAppPath()
  const fontsDir = (() => {
    const dirs = [
      join(base, 'resources', 'fonts'),
      join(base, '..', 'resources', 'fonts'),
      join(base, '..', '..', 'resources', 'fonts'), // dev: out/main/../../resources/fonts
      join(process.resourcesPath ?? '', 'fonts')
    ]
    for (const d of dirs) {
      try { if (existsSync(join(d, 'cairo-regular.ttf'))) return d } catch { /* */ }
    }
    return dirs[0]
  })()

  _assets = {
    regular: enc(join(fontsDir, 'cairo-regular.ttf')),
    bold: enc(join(fontsDir, 'cairo-bold.ttf')),
    logo: enc(findAsset('logo.png'), 'image/png')
  }
  return _assets
}

// ─── HTML escaping ─────────────────────────────────────────────────────────────

function esc(s: string): string {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

// ─── bill renderer ─────────────────────────────────────────────────────────────

function renderInvoiceHtml(inv: Invoice, settings: Settings): string {
  const a = assets()
  const dec = settings.currencyDecimals ?? 3
  const cur = settings.currency ?? 'OMR'
  const m = (v: number) => formatMoney(v, dec, cur)

  // Document title based on type
  const docTitleAr =
    inv.documentType === 'quotation' ? 'عرض سعر' :
    inv.documentType === 'receipt'   ? 'إيصال استلام' :
                                       'فاتورة نقدية / على الحساب'
  const docTitleEn =
    inv.documentType === 'quotation' ? 'QUOTATION' :
    inv.documentType === 'receipt'   ? 'RECEIPT' :
                                       'CASH / ON ACCOUNT INVOICE'

  // Items rows — pad to 14 rows so the table fills the single A4 page
  const dataRows = inv.items.map((it, i) => {
    const name = it.nameSnapshot ?? ''
    const nameDir = hasArabic(name) ? 'rtl' : 'ltr'
    const unitP = Number(it.unitPrice) + Number(it.extraPrice ?? 0)
    return `<tr class="${i % 2 === 1 ? 'alt' : ''}">
      <td class="c">${esc(it.code ?? '')}</td>
      <td dir="${nameDir}" class="desc">${esc(name)}</td>
      <td class="c">${Number(it.qty).toLocaleString('en-US')}</td>
      <td class="c">${m(unitP)}</td>
      <td class="c">${m(it.lineTotal)}</td>
    </tr>`
  })
  const blankCount = Math.max(0, 14 - dataRows.length)
  const blankRows = Array.from({ length: blankCount }, () =>
    `<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>`
  )
  const allRows = [...dataRows, ...blankRows].join('\n')

  // Customer — the name is either Arabic OR English (never both). The whole
  // block follows the script of the name: Arabic → right-aligned (RTL),
  // English → left-aligned (LTR), with the phone shown underneath on the
  // same side.
  const custName = (inv.customerName || '').trim() || (inv.customerNameEn || '').trim()
  const custPhone = (inv.customerPhone || '').trim()
  const custUseArabic = custName ? hasArabic(custName) : true
  const custGreeting = custUseArabic ? 'الفاضل / الأفاضل:' : 'Mr./Mrs:'
  const custPhoneLabel = custUseArabic ? 'رقم الهاتف:' : 'Phone:'
  const custRowClass = custUseArabic ? 'cust-ar' : 'cust-en'

  // Date
  const dateStr = inv.date ? inv.date.slice(0, 10) : ''

  // Tax rate as %
  const taxPct = ((Number(inv.taxRate ?? 0.05)) * 100).toFixed(0)

  // Notes
  const notesDir = inv.notes && hasArabic(inv.notes) ? 'rtl' : 'ltr'

  // Address lines (split on newline so user can write multi-line address)
  const addrLines = (settings.businessAddress ?? '').split('\n').filter(Boolean)
  const addrHtml = addrLines.map(l => `<div>${esc(l)}</div>`).join('')

  const logoSrc = a.logo ? `<img src="${a.logo}" class="logo-img" alt="logo" />` : ''

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<style>
  @font-face {
    font-family: 'Cairo';
    src: url('${a.regular}') format('truetype');
    font-weight: 400 600;
    font-style: normal;
  }
  @font-face {
    font-family: 'Cairo';
    src: url('${a.bold}') format('truetype');
    font-weight: 700 900;
    font-style: normal;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'Cairo', 'Arial', sans-serif; font-size: 9pt; color: #111; }

  @page {
    size: A4 portrait;
    margin: 0;
  }

  .page {
    width: 210mm;
    height: 297mm;          /* exactly one A4 page; overflow is clipped */
    padding: 5mm 10mm 5mm 10mm;
    position: relative;
    overflow: hidden;
  }

  /* ── header ─────────────────────────────── */
  .header {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 4mm;
    padding-bottom: 2mm;
  }
  .addr-en {
    font-size: 7.5pt;
    line-height: 1.55;
    color: #1a1a1a;
    direction: ltr;
    text-align: left;
  }
  .addr-ar {
    font-size: 7.5pt;
    line-height: 1.55;
    color: #1a1a1a;
    direction: rtl;
    text-align: right;
  }
  .brand {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5mm;
  }
  .logo-img { height: 16mm; width: auto; }
  .brand-sub {
    font-size: 7pt;
    color: #555;
    line-height: 1.4;
    text-align: center;
  }
  .brand-name-en {
    font-size: 8pt;
    font-weight: 700;
    letter-spacing: 0.03em;
    color: #1a1a1a;
    direction: ltr;
  }
  .brand-name-ar {
    font-size: 9pt;
    font-weight: 700;
    color: #1a1a1a;
    direction: rtl;
  }

  /* ── blue bar ────────────────────────────── */
  .bar {
    background: #1c4e8a;
    height: 5mm;
    margin: 0 -10mm;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 8pt;
    letter-spacing: 0.03em;
  }

  /* ── invoice meta row ────────────────────── */
  .inv-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 2mm 0;
    border-bottom: 1px solid #ccc;
  }
  .inv-no {
    font-size: 9pt;
    direction: ltr;
    min-width: 30mm;
  }
  .inv-no strong { color: #c00; font-size: 11pt; }
  .inv-title {
    text-align: center;
    font-size: 11pt;
    font-weight: 800;
    color: #1c4e8a;
    flex: 1;
    direction: rtl;
    line-height: 1.3;
  }
  .inv-title-sub { font-size: 8pt; font-weight: 500; color: #444; direction: ltr; }
  .inv-date {
    font-size: 9pt;
    text-align: right;
    min-width: 40mm;
    direction: rtl;
    line-height: 1.5;
  }

  /* ── customer row ─────────────────────────── */
  .customer-row {
    padding: 2mm 0;
    border-bottom: 1.5px solid #b0b0b0;
    font-size: 9pt;
  }
  /* Arabic name → block sits on the right; English name → on the left */
  .customer-row.cust-ar { direction: rtl; text-align: right; }
  .customer-row.cust-en { direction: ltr; text-align: left; }
  .cust-greeting { color: #666; font-size: 8.5pt; }
  .cust-name {
    font-weight: 700;
    font-size: 11pt;
    color: #111;
    margin-inline-start: 1.5mm;
  }
  .cust-phone { color: #444; font-size: 9pt; margin-top: 1.2mm; }
  /* digits stay LTR even inside the RTL (Arabic) block */
  .cust-phone .num {
    font-family: 'Courier New', monospace;
    font-weight: 600;
    letter-spacing: 0.04em;
  }

  /* ── items table ─────────────────────────── */
  .items-wrap {
    position: relative;
    margin: 1.5mm 0;
  }
  .watermark {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    opacity: 0.06;
    z-index: 0;
    pointer-events: none;
    width: 110mm;
    height: auto;
  }
  table.items {
    width: 100%;
    border-collapse: collapse;
    position: relative;
    z-index: 1;
    font-size: 8.5pt;
  }
  table.items thead tr {
    background: #1c4e8a;
    color: white;
  }
  table.items th {
    padding: 1.4mm 2.5mm;
    text-align: center;
    font-weight: 700;
    font-size: 8pt;
    border: 1px solid #1a4070;
    line-height: 1.3;
  }
  table.items td {
    padding: 1mm 2.5mm;
    border: 0.5px solid #d0d0d0;
    vertical-align: middle;
    height: 5.5mm;
  }
  table.items td.c { text-align: center; }
  table.items td.desc { text-align: start; }
  table.items tr.alt td { background: #f4f8ff; }

  /* col widths */
  .col-code { width: 12%; }
  .col-desc { width: 36%; }
  .col-qty  { width: 10%; }
  .col-rate { width: 21%; }
  .col-amt  { width: 21%; }

  /* ── bottom section ─────────────────────── */
  .bottom {
    display: flex;
    gap: 4mm;
    margin-top: 2mm;
    align-items: flex-start;
  }
  .totals-box {
    border: 1.5px solid #1c4e8a;
    border-radius: 2mm;
    overflow: hidden;
    min-width: 68mm;
    font-size: 9.5pt;
  }
  .totals-box .t-row {
    display: flex;
    justify-content: space-between;
    padding: 1.3mm 3mm;
    border-bottom: 1px solid #c8d8ec;
    gap: 4mm;
    align-items: center;
  }
  .totals-box .t-row:last-child { border-bottom: none; }
  .totals-box .t-row.grand {
    background: #1c4e8a;
    color: white;
    font-weight: 700;
    font-size: 10pt;
  }
  .totals-box .t-row.balance-row {
    background: #fff4e6;
    color: #8b2500;
    font-weight: 700;
  }
  .t-label-en { direction: ltr; white-space: nowrap; }
  .t-label-ar { direction: rtl; white-space: nowrap; font-size: 8.5pt; }
  .t-val { direction: ltr; font-weight: 600; white-space: nowrap; }

  .notes-area {
    flex: 1;
    border: 1px solid #d0d0d0;
    border-radius: 2mm;
    padding: 2mm 3mm;
    font-size: 8.5pt;
    min-height: 22mm;
  }
  .notes-label { font-weight: 700; color: #555; margin-bottom: 1.5mm; font-size: 8pt; }

  /* ── footer area ────────────────────────── */
  .footer-bar {
    margin: 3mm -10mm 0 -10mm;
    background: #1c4e8a;
    color: white;
    text-align: center;
    padding: 2mm;
    font-size: 9pt;
    letter-spacing: 0.02em;
  }
  .terms {
    margin-top: 2mm;
    font-size: 7pt;
    color: #333;
    direction: rtl;
    text-align: right;
    line-height: 1.4;
  }
  .terms p { margin-bottom: 0.8mm; }
  .signatures {
    display: flex;
    justify-content: space-between;
    margin-top: 3mm;
    font-size: 8.5pt;
    color: #333;
    direction: ltr;
  }
</style>
</head>
<body>
<div class="page">

  <!-- ══ HEADER ══════════════════════════════════════════════════════════ -->
  <div class="header">
    <!-- EN address (LTR) -->
    <div class="addr-en">
      <div style="font-weight:700;">${esc(settings.businessName)}</div>
      ${addrHtml || '<div style="color:#999;">—</div>'}
      ${settings.businessPhone ? `<div>Phone: ${esc(settings.businessPhone)}</div>` : ''}
    </div>

    <!-- Brand centre -->
    <div class="brand">
      ${logoSrc}
      <div class="brand-name-ar">${esc(settings.businessNameAr || settings.businessName)}</div>
      <div class="brand-sub" style="direction:ltr;">${esc(settings.businessName)}</div>
    </div>

    <!-- AR address (RTL) -->
    <div class="addr-ar">
      <div style="font-weight:700;">${esc(settings.businessNameAr || settings.businessName)}</div>
      ${addrHtml || '<div style="color:#999;">—</div>'}
      ${settings.businessPhone ? `<div>هاتف: ${esc(settings.businessPhone)}</div>` : ''}
    </div>
  </div>

  <!-- ══ BLUE BAR ════════════════════════════════════════════════════════ -->
  <div class="bar"></div>

  <!-- ══ INVOICE META ROW ════════════════════════════════════════════════ -->
  <div class="inv-meta">
    <div class="inv-no" dir="ltr">
      NO &nbsp;<strong>${inv.number}</strong>
    </div>
    <div class="inv-title">
      <div>${esc(docTitleAr)}</div>
      <div class="inv-title-sub">${esc(docTitleEn)}</div>
    </div>
    <div class="inv-date">
      <div>التاريخ &nbsp;&nbsp; Date</div>
      <div style="font-weight:600;direction:ltr;">${esc(dateStr)}</div>
    </div>
  </div>

  <!-- ══ CUSTOMER ROW ════════════════════════════════════════════════════ -->
  <div class="customer-row ${custRowClass}">
    <span class="cust-greeting">${esc(custGreeting)}</span>
    <span class="cust-name">${esc(custName)}</span>
    ${custPhone
      ? `<div class="cust-phone">${esc(custPhoneLabel)} <span class="num" dir="ltr">${esc(custPhone)}</span></div>`
      : ''}
  </div>

  <!-- ══ ITEMS TABLE ══════════════════════════════════════════════════════ -->
  <div class="items-wrap">
    ${a.logo ? `<img class="watermark" src="${a.logo}" alt="" />` : ''}
    <table class="items">
      <colgroup>
        <col class="col-code" />
        <col class="col-desc" />
        <col class="col-qty" />
        <col class="col-rate" />
        <col class="col-amt" />
      </colgroup>
      <thead>
        <tr>
          <th>الرقم<br/>NO.</th>
          <th>التفاصيل<br/>Description</th>
          <th>الكمية<br/>QTY.</th>
          <th>السعر<br/>Rate R.O</th>
          <th>المبلغ<br/>Amount R.O</th>
        </tr>
      </thead>
      <tbody>
        ${allRows}
      </tbody>
    </table>
  </div>

  <!-- ══ TOTALS + NOTES ══════════════════════════════════════════════════ -->
  <div class="bottom">
    <div class="totals-box">
      <div class="t-row">
        <span class="t-label-en">Total</span>
        <span class="t-label-ar">المجموع</span>
        <span class="t-val">${m(inv.subtotal)}</span>
      </div>
      ${inv.discount > 0 ? `
      <div class="t-row">
        <span class="t-label-en">Discount</span>
        <span class="t-label-ar">خصم</span>
        <span class="t-val">- ${m(inv.discount)}</span>
      </div>` : ''}
      <div class="t-row">
        <span class="t-label-en">Tax ${taxPct}%</span>
        <span class="t-label-ar">ضريبة ${taxPct}%</span>
        <span class="t-val">${m(inv.taxAmount)}</span>
      </div>
      <div class="t-row grand">
        <span class="t-label-en">TOTAL</span>
        <span class="t-label-ar">الإجمالي</span>
        <span class="t-val">${m(inv.total)}</span>
      </div>
      <div class="t-row">
        <span class="t-label-en">Advance</span>
        <span class="t-label-ar">المدفوع</span>
        <span class="t-val">${m(inv.advance)}</span>
      </div>
      <div class="t-row balance-row">
        <span class="t-label-en">Balance</span>
        <span class="t-label-ar">الباقي</span>
        <span class="t-val">${m(inv.balance)}</span>
      </div>
    </div>

    <div class="notes-area">
      <div class="notes-label">ملاحظات / Notes</div>
      ${inv.notes
        ? `<div dir="${notesDir}">${esc(inv.notes)}</div>`
        : '<div style="color:#ccc;">—</div>'}
    </div>
  </div>

  <!-- ══ FOOTER BAR ══════════════════════════════════════════════════════ -->
  <div class="footer-bar">
    ${settings.businessEmail
      ? `Email: ${esc(settings.businessEmail)}`
      : '&nbsp;'}
  </div>

  <!-- ══ TERMS ═══════════════════════════════════════════════════════════ -->
  <div class="terms">
    <p>* الشركة غير مسؤولة عن اختلاف الألوان في الرخام والجرانيت لأنها مواد طبيعية وتوزيع الألوان والنقاط فيها طبيعي</p>
    <p>* نطلب من المستهلك معاينة الرخام الذي اختاره لأنه بعد الاتفاق لن يتم تغيير أي شي</p>
    <p>* الرجاء دفع المبالغ المتبقية قبل خروج البضاعة من المصنع</p>
  </div>

  <!-- ══ SIGNATURES ══════════════════════════════════════════════════════ -->
  <div class="signatures">
    <span>Recipient's sign .............. &nbsp; توقيع المستلم</span>
    <span>Signature .............. &nbsp; التوقيع</span>
  </div>

</div>
</body>
</html>`
}

// ─── public API ───────────────────────────────────────────────────────────────

export async function renderInvoicePdf(
  inv: Invoice,
  settings: Settings,
  _language: 'en' | 'ar',
  targetPath: string
): Promise<string> {
  const html = renderInvoiceHtml(inv, settings)
  const win = new BrowserWindow({
    show: false,
    width: 794,   // ~210mm at 96dpi
    height: 1123, // ~297mm at 96dpi
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  try {
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
    await win.loadURL(dataUrl)
    await win.webContents.executeJavaScript(
      'document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()'
    )
    const buf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'none' }
    })
    writeFileSync(targetPath, buf)
    return targetPath
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

// Exposed for tests / preview
export const _renderInvoiceHtml = (inv: Invoice, settings: Settings) =>
  renderInvoiceHtml(inv, settings)
