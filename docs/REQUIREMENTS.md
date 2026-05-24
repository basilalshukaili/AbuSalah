# Abu Salah Pro — Functional Requirements

> Distilled from observing the old workflow only. **No implementation choices are inherited.**

## Business

Abu Salah is a **home-finishing materials shop in Oman** (curtains, ceramic, granite, flooring, decoration). The owner is **elderly** and his Arabic is primary. Currency is **OMR**, VAT is **5%** (configurable).

## User stories

### Selling — issuing an invoice

- *As the owner, I want to make an invoice in under a minute so I don't keep customers waiting.*
- The invoice needs: customer name, customer phone, one or more items, optional discount, optional advance payment, optional notes.
- Each item line is: a product (chosen from the inventory), a quantity, and an optional "extra" amount that adds to the unit price for that line (used for custom modifications).
- Each line's total = `(unit_price + extra) × quantity`.
- Subtotal = sum of line totals.
- Tax = `(subtotal − discount) × tax_rate`.
- Total = `subtotal − discount + tax`.
- Balance = `total − advance`.
- Saving an invoice **must** decrement stock for each product and store an inventory movement.
- Saving must be atomic — either the invoice and the stock movement both happen or neither does.
- After save the system prints / exports the invoice to PDF with the shop logo, the invoice number, the date, and the items in Arabic where applicable.

### Looking up an old invoice

- *As the owner, I want to find an invoice quickly when a customer comes back asking about it.*
- Search by customer **phone** (primary), customer **name**, **invoice number**, or **date range**.
- Results show date, customer, total, balance, status; opening shows the full breakdown.
- Re-print the same invoice as PDF.
- Void an invoice (with a reason) — voiding **restores stock** and is itself audited.

### Inventory

- *As the owner, I want to add a new product, restock an existing one, and see what is running low.*
- Product fields: code, English name, Arabic name, unit (default `m`), unit price, current quantity, low-stock threshold, optional category, notes.
- Restocking a product creates an inventory movement (+qty) and updates current quantity.
- Adjusting a product sets quantity to an absolute value and records the delta as a movement.
- A product cannot be hard-deleted if it has been used on any invoice (use soft-delete via `active=false`).
- Low-stock filter shows products at/below their threshold.

### Customers

- *As the owner, I want to keep track of who owes what.*
- Customer is keyed by phone (natural key from the old data).
- Show outstanding balance per customer (sum of unpaid + partial invoices).
- Edit, soft-disable, search by name/phone.

### Reports

- KPIs: today, this month, custom range (count of invoices, total sales, tax collected, outstanding).
- Sales by day & by month (table + simple bar chart).
- Top products & top customers.
- Export the chosen range to **Excel** (.xlsx) and to a printable **PDF** report.

### Settings

- Shop name (English + Arabic), phone, address.
- Tax rate.
- Language (English / العربية) hot-switch.
- Theme (Light / Dark).
- Font size (large by default, scalable for low vision).
- Backup now / Restore from backup / Auto-backup on launch.
- One-click **import legacy data** from the old `bills/` and `items/` folders.

## Non-functional requirements

- **Local Windows app**, single-folder install, no external server.
- **Bilingual** UI with hot RTL/LTR switch.
- **Arabic must render correctly** in every UI surface and in PDFs — this is a hard gate, validated automatically.
- **Easy for an elderly user**: large default text (~18 px equivalent), big buttons (≥ 48 px tall), high contrast, generous spacing, friendly confirmations on destructive actions, undo where possible.
- **Reliable**: ACID database, automatic backups, transactional invoice save, no silent failures.
- **Modern look** — distinctly different from the old purple-only theme. New palette is **Slate** (neutral charcoal) + **Amber** (warm accent), with full light & dark modes.
- **Tested**: unit + integration + end-to-end with screenshots verifying Arabic rendering & RTL layout.
- **Validated startup**: launching via `start.bat` must open a window, with the running process verified.

## Out of scope (this version)

- Multi-user / role-based access (single-operator shop).
- Cloud sync, web access.
- Barcode scanner integration (kept as future enhancement).
