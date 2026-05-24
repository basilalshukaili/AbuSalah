# ADR-001 — Choose a modern stack for Abu Salah Pro v2

## Status

Accepted (2026-05-04) — supersedes the abandoned Python/PySide6 prototype.

## Context

Version 1 used Python + PySide6 + SQLite. Three failure modes drove a rewrite:

1. **Arabic was not rendered correctly** in the running app or in the generated PDF, despite using `arabic-reshaper` + `python-bidi`.
2. **`start.bat` was not validated** — it was written but never run from a real shell.
3. The look-and-feel inherited the old purple theme instead of being modern.

We need a stack where Arabic shaping is a non-issue, where the UI looks contemporary, and where automated end-to-end validation (including pixel screenshots of Arabic) is straightforward.

## Decision

Use **Electron 30 + React 18 + TypeScript + Vite + shadcn/ui + Tailwind + Drizzle + `@libsql/client`**.

> **Note:** This ADR originally specified `better-sqlite3`. We switched to `@libsql/client` (libSQL — a SQLite-compatible fork by Turso) because `better-sqlite3` failed to install on the target Windows machine (no Visual Studio Build Tools, no prebuilds for Node 24). `@libsql/client` ships prebuilt napi-rs binaries that "just work" everywhere. The trade-off is that all DB calls are async — this is fine and consistent with modern Node patterns.

### Why Electron over Tauri / .NET / Qt

| Concern | Electron | Tauri | .NET MAUI / WPF | Qt / PySide |
|---|---|---|---|---|
| Arabic shaping | **Native via Chromium** ✅ | Native via WebView2 ✅ | Mediocre, font-dependent | Mediocre (bit us in v1) |
| RTL flip | Built-in (`dir="rtl"`) ✅ | Built-in ✅ | Possible but verbose | Verbose |
| Modern UI ecosystem | shadcn / Radix / Tailwind ✅ | Same web stack ✅ | Limited | Limited |
| Toolchain on user machine | Node (already installed) ✅ | Rust toolchain | .NET SDK | Python + Qt |
| PDF with perfect Arabic | `webContents.printToPDF()` ✅ | Native print | Custom | Custom |
| Distributable | electron-builder → `.exe` ✅ | tauri build → `.exe` ✅ | publish → `.exe` | PyInstaller (fragile) |
| Bundle size | ~120 MB | ~10 MB | varies | varies |

**Rejected Tauri** despite its smaller bundle: requires the user (and CI) to have the Rust toolchain installed. Electron is friction-free given Node is already present.

**Rejected .NET MAUI / WPF**: best for native Windows feel, but the modern web UI ecosystem (shadcn, Radix, Tailwind) outclasses native control libraries for the look-and-feel target.

**Rejected anything Python/Qt**: caused the original Arabic rendering bug. Removing Qt removes a whole class of font/shaping risk.

### Why React + TypeScript + shadcn/ui

- **shadcn/ui** is the current reference for modern, accessible, customisable React components — it generates components into the project (no opaque library dependency) so they can be themed precisely.
- **TypeScript** end-to-end (main process, IPC, renderer) catches bugs at compile time and makes the IPC contract explicit.
- **Vite** for fast HMR during development; `electron-vite` integrates cleanly.

### Why Drizzle + `@libsql/client`

- **`@libsql/client`** uses napi-rs prebuilt binaries — zero native build step on Windows, macOS, Linux. Same SQL dialect as SQLite.
- **Drizzle ORM** is type-safe, ergonomic, and produces SQL we can read. It has first-class libsql support.
- Trade-off: API is async — all DB calls are `await` (consistent with the rest of modern Node/Electron code).

### Why printToPDF for invoices

The simplest reliable way to render Arabic in a PDF is to **render it as HTML in Chromium and let Chromium produce the PDF**. This sidesteps every shaping/embedding/font-fallback issue that bit v1.

### Color palette

**Slate + Amber**, distinct from v1's purple. Background charcoal `#0f172a` (slate-900), surface `#1e293b` (slate-800), text `#f1f5f9` (slate-100), accent `#f59e0b` (amber-500), success `#10b981` (emerald-500), danger `#f43f5e` (rose-500). Light mode uses slate-50 / slate-900 / amber-600.

### Fonts

Bundle **Cairo** (Google Fonts) and **Inter** as project assets so Arabic and Latin both have a modern face. Fall back to system fonts only if bundling fails.

## Consequences

- Bundle is ~120 MB for the unpacked app. Acceptable for a desktop business tool; a minor cost for the productivity gains.
- We commit to maintaining the React component code; team must know React. Acceptable.
- Builds require Node 20+. Already installed on the target machine.
