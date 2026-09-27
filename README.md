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
- **Phone access on the local Wi‑Fi** — open the one-click URL shown in
  **Settings → Mobile access**. The responsive phone UI uses the same live data as the
  PC, and phone print buttons send directly to the PC's default printer.
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

## Deploying to a client

The app runs **from source** — no installer required.

**First install (once per client PC):**

1. Install **Node.js 20+** (<https://nodejs.org>) and **Git** (<https://git-scm.com>).
2. Clone the repository (e.g. onto the Desktop):
   ```bash
   git clone https://github.com/basilalshukaili/AbuSalah.git
   ```
3. Open the `AbuSalah` folder and double‑click **`start.bat`**.
   The first run installs dependencies and builds the app (a few minutes, needs
   internet once), then launches it. Every later launch is instant.

**Updating to the latest version:**

- Double‑click **`update.bat`**. It safeguards any local changes, downloads and applies
  only a safe fast-forward update, restores the safeguarded changes, refreshes
  dependencies, rebuilds, and relaunches. It never intentionally discards local files.

> This source-run installation's data (database + automatic backups) lives under
> `%APPDATA%\Electron`,
> **outside** the project folder — so updating the code never touches it.

## Phone access

The built-in LAN server uses fixed TCP port **47831**. There is no phone app or printer
driver to install:

1. Keep the Abu Salah desktop app open and keep the PC awake.
2. Connect the PC and phone to the same trusted shop/home Wi-Fi.
3. On the PC, open **Settings → Mobile access** and copy the displayed one-click URL.
4. Open that complete URL on the phone. Pairing is automatic, and the access key is
   immediately removed from the phone's address bar.

On first setup, run **`enable-phone-firewall.bat`** once and approve the Windows
administrator prompt. Its rule is limited to Private networks, the local subnet, and
TCP 47831. If Windows currently labels the trusted Wi-Fi as Public, change that
specific Wi-Fi's **Network profile type** to **Private** in Windows Settings.

Printing from either the PC or phone is silent: the job is sent to the Windows default
printer on the PC. If no printer/default printer is available, the app shows a clear
error instead of opening a browser.

Do not expose port 47831 with router port-forwarding, and do not enable access on
hotel, airport, café, or other untrusted Wi-Fi.

## Remote access from a different network (e.g. from home)

Phone access above only works on the *same* Wi-Fi as the PC. Reaching the app from a
different network (checking on it from home while the PC stays on at the shop/factory)
uses a separate mechanism, in `remote-access/`:

- The PC dials **out** to our VPS through a restricted SSH reverse tunnel — **no inbound
  port is ever opened** on the PC or its network, and nothing needs to change on the
  router.
- The tunnel only forwards the same port the phone feature already uses (47831), so
  everything phone access enforces — same-network-shaped auth, the 6-digit pairing PIN,
  session tokens — still applies to a request arriving this way.
- On our VPS, Caddy requires a **separate password (HTTP Basic Auth)** in front of
  `abusalah.techmate.om`, before it ever reaches the tunnel. This app is a
  single-workstation desktop tool and was never built to sit behind a public hostname;
  a hostname alone is not authentication, so nothing is reachable there without both
  this password and the pairing PIN.
- Printing is unaffected either way: it always happens on the PC's own local printer,
  never anywhere else.

One-time setup on the PC (needs the private key file for this, handed over separately —
**never** put it inside this cloned folder, since `update.bat` can reset this folder to
match GitHub):

1. Copy the private key file to `%APPDATA%\AbuSalahTunnel\abusalah_tunnel_key`.
2. Run `remote-access\install-tunnel-task.ps1` once (double-click, or right-click →
   "Run with PowerShell"; no admin rights needed). It locks the key file down to your
   Windows account and registers a background task that starts the tunnel at log-on and
   restarts it automatically.
3. Keep the PC on, awake, and logged in with the Abu Salah app open, same as for phone
   access. Check `%APPDATA%\AbuSalahTunnel\tunnel.log` if it doesn't seem to be working.

See `remote-access/abusalah-tunnel.ps1` for exactly what the tunnel does and does not do.

### Optional: standalone installer

For a no‑Node install, `npm run build:win` packages an NSIS `.exe` into `release/`.
It needs a few GB of free disk space and produces an unsigned installer (SmartScreen
will warn → **More info → Run anyway**). The clone + `start.bat` flow above is the
recommended path.

## Data & backups

- In the recommended source-run setup, the database and automatic backups are stored
  per-Windows-user under **`%APPDATA%\Electron`**, so data survives code updates.
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
