# Abu Salah — ابو صلاح

A modern, bilingual (Arabic / English) desktop **billing & inventory** system for a
home‑finishing materials shop in Oman (marble, granite, ceramic, curtains, flooring).
Built to be fast for a single operator, with correct Arabic rendering both on screen
and in printed invoices.

> Replaces an earlier Python/PySide6 prototype that could not render Arabic correctly.
> See [`docs/ADR-001-stack.md`](docs/ADR-001-stack.md) for the rationale.

## Features

- **Fast invoicing** — issue a cash / on‑account invoice in under a minute: searchable
  customer, searchable products, quantity + optional per‑line extra charge, discount,
  advance payment, and notes.
- **Single‑page A4 PDF** invoices with the shop logo and bilingual columns. The customer
  block follows the name's language automatically — Arabic name → right‑aligned with
  `رقم الهاتف:`, English name → left‑aligned with `Mr./Mrs:` and `Phone:`.
- **Inventory** — products with English & Arabic names, price, stock, and low‑stock
  threshold; atomic stock decrement on every sale; restock and movement history;
  soft‑delete (history is preserved).
- **Customers** — keyed by phone, searchable by Arabic/English name or phone, with
  outstanding‑balance tracking.
- **Invoice lookup** — search by phone, name, invoice number, or date range; reprint to
  PDF; void an invoice (restores stock, fully audited).
- **Reports** — KPIs (day / month / custom range), sales by day & month, top products &
  customers; export to **Excel** and **PDF**.
- **Bilingual UI** with instant RTL/LTR switch, light/dark themes, and large accessible
  text for low‑vision users.
- **Reliable** — transactional (ACID) writes via libSQL, automatic backup on launch,
  restore from backup, and one‑click import of legacy data.

Full functional spec: [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md).

## Tech stack

| Layer | Choice |
|---|---|
| Shell | Electron 33 |
| UI | React 18 + TypeScript, Tailwind CSS, shadcn/ui (Radix) |
| Build | Vite via `electron-vite` |
| Data | Drizzle ORM + `@libsql/client` (SQLite‑compatible, prebuilt binaries) |
| i18n | i18next / react‑i18next (`ar`, `en`) |
| PDF | Chromium `webContents.printToPDF()` (perfect Arabic shaping) |
| Packaging | electron‑builder (NSIS installer) |

## Prerequisites

- **Windows 10 / 11**
- **Node.js 20+** — check with `node --version`

## Getting started (development)

```bash
git clone https://github.com/basilalshukaili/AbuSalah.git
cd AbuSalah
npm install
npm run dev        # launch the app with hot reload
```

## npm scripts

| Script | What it does |
|---|---|
| `npm run dev` | Run the app in development (hot reload) |
| `npm run build` | Type‑check + build production bundles into `out/` |
| `npm run build:win` | Build **and** package a Windows installer into `release/` |
| `npm test` | Unit (Vitest) + end‑to‑end (Playwright) |
| `npm run test:unit` | Unit / integration tests |
| `npm run typecheck` | TypeScript check (web + node configs) |
| `npm run lint` / `npm run format` | ESLint / Prettier |

## Building the installer

```bash
npm run build:win
```

Produces **`release/AbuSalah-Setup-2.0.0.exe`** (NSIS, x64). The installer bundles
Electron, so the client machine needs nothing pre‑installed.

> **Notes**
> - The first build downloads Electron + NSIS binaries (needs internet once) and a few
>   **GB of free disk space** for temporary packaging files.
> - The installer is **unsigned**, so Windows SmartScreen shows "Windows protected your
>   PC" → click **More info → Run anyway**. Removing this requires a paid code‑signing
>   certificate.

## Shipping to a client

**Option A — Installer (recommended).** Run `npm run build:win`, copy
`release/AbuSalah-Setup-2.0.0.exe` to the client, and run it. It installs the app and
creates Desktop + Start‑Menu shortcuts. **No Node.js needed on the client.**

**Option B — Folder + `start.bat`.** Copy the project folder to the client, install
Node.js 20+, then double‑click **`start.bat`** (first run installs dependencies, builds,
and launches). Use this when an installer build isn't available.

## Data & backups

- The database and automatic backups are stored per‑Windows‑user under
  **`%APPDATA%\Abu Salah`**, so data survives reinstalls and updates.
- A backup is taken automatically on launch; restore via **Settings → Data**.
- Database files (`*.db`) are git‑ignored and must never be committed.

## Project structure

```
src/
  main/         Electron main process
    domain/       invoices, products, customers, reports
    services/     pdf-service, excel-export, backup, legacy-import
    db/           schema, connection, bootstrap (Drizzle + libSQL)
    ipc/          IPC handlers
  preload/      contextBridge IPC surface
  renderer/     React app (routes, components, i18n, stores)
  shared/       types & formatting shared across processes
resources/      logo, icon, Cairo fonts
docs/           architecture decision record + requirements
```

## License

© Abu Salah Projects. All rights reserved.

---

## للمستخدم — تشغيل البرنامج

برنامج **ابو صلاح** لإدارة الفواتير والمخزون.

- **التثبيت على جهاز الزبون:** انسخ ملف `AbuSalah-Setup-2.0.0.exe` إلى الجهاز ثم شغّله،
  وسيُنشئ اختصاراً على سطح المكتب. لا يحتاج الجهاز إلى تثبيت أي برامج أخرى.
- إذا ظهرت رسالة حماية Windows، اضغط **More info** ثم **Run anyway**.
- تُحفظ البيانات والنسخ الاحتياطية تلقائياً على الجهاز، وتبقى محفوظة عند إعادة التثبيت
  أو التحديث.
