# Touchscreen POS: plan

The POS replaces the current Windows billing software on the counter touchscreen. It lives in `apps/pos`, uses the same database and API as the admin app, and keeps billing even when the internet drops.

## What it replaces (from the current POS screenshots)

| Today's POS | Mausam POS v1 |
| --- | --- |
| Table dashboard by area (Garden C1–C15, Rooftop D1–D7) with Vacant / Running / Billed colours, amount and time open | Same: tables by area, three clear states (Free, Ordering, Bill printed), amount and minutes open |
| Billing screen: category tabs on the left, item tiles with price, order list on the right | Same layout, bigger tiles, search box, favourites row |
| Dine-in / Parcel, token number, waiter | Same; parcels get an automatic token number |
| Hold, Bill, Save & Print, Cancel, Cash | Send to kitchen, Show bill, Take payment (Cash / UPI / Card / split), Cancel with a reason |
| Item master (name, category, price, CGST/SGST, HSN) | **Menu** page in the admin app (owner): categories, items, prices, GST, favourites, hide/show |
| Masters: waiter, table, category, payment mode | Waiters come from **Staff**; tables from a new **Tables** page in the admin app |
| Reports: sales summary, item sales, waiter commission | Already in the admin app (sales, best sellers). POS bills feed them automatically |
| Day End | **Day summary** on the POS (totals by payment mode), and the admin "Close the day" gets the POS total filled in |

## How it fits with the admin app

- **One Worker, one address.** The POS is served at `/pos/` by the same Worker. `pnpm ship` builds and publishes both.
- **Same login.** A manager (or a user with the `staff` role, for a cashier) logs in once on the counter. The login lasts 60 days.
- **Bills flow into everything that exists.** Each synced bill updates that day's `pos_daily` (total, cash, online, bills, dine-in, parcel, discount, cancelled) and `pos_items` (item sales). That means:
  - the nightly closing gets the POS total pre-filled and compared, as with imports today;
  - best sellers, sales and costs reports work with no extra steps;
  - no more Excel export and import.
- **Shared bill maths** (`packages/shared/src/billing.ts`): line totals, GST split, round-off. The POS uses it to show totals and the API uses it to re-check every bill, so they can never disagree.

## Offline first

- On start, the POS downloads the menu, tables, waiters and settings and keeps a copy on the device.
- Open tables and orders live on the device and survive a reload or power cut.
- A finished bill goes into an **outbox** on the device and is sent to the server when online. Each bill carries a unique id, so sending twice never creates a duplicate.
- **Bill numbers** are made on the device: a counter code plus a running number per financial year (for example `A-00042`). They are unique without asking the server, which matters for GST invoices.
- A small banner shows "Offline: 3 bills waiting to send". The admin app shows the POS last-seen time so the owner knows if a counter stopped syncing.

## GST

GST is **off** (Manage → POS options). With it off, bills have no tax lines. The GST code stays: switching it on brings back the GSTIN, the rate (default 5%: CGST 2.5% + SGST 2.5%), and whether menu prices include GST.

## Tables

The table map is **off**. "New table order" asks who is serving and, optionally, the table number on a number pad; open orders are listed by order number (oldest first). Switching the table map on in POS options brings back areas and table cards from Manage → Tables.

## Waiters

A waiter is a staff member marked as a waiter in **Manage → Waiters**, with a short ID (shown on the POS) and an optional commission %. One default % applies to waiters without their own. A dine-in order asks for the waiter when it's opened, and payment isn't taken without one (this can be switched off). The commission is a % of each paid bill before GST, saved on the bill when it syncs. It shows in **Reports → Waiters** (by day and month) and is added to month-end pay.

## Printing

There is **no printer**: the counter is a touch PC or tablet. "Send to kitchen" marks the new items as sent and shows them in big text to read out; "Show bill" shows the bill on screen for the guest; after payment the screen shows "Paid" and the change to give back. If a receipt printer is added later, switching it on in POS options makes the same buttons print through the browser on an 80 mm layout (Chrome kiosk mode with `--kiosk-printing` avoids the print dialog).

## Screens (landscape, 1366×768 and up, big touch targets)

1. **Login** (once): phone + PIN on a big number pad.
2. **Tables**: area tabs, table cards coloured by state, a big "Parcel" button.
3. **Order**: categories (left), items grid with search (middle), the order with + / − and notes (right). Buttons: Print KOT, Print bill, Pay.
4. **Pay**: amount due in big numbers, Cash / UPI / Card buttons, cash given → change to return, and split payments.
5. **Day summary**: today's bills, totals by mode, cancelled bills, and the sync status.

Languages: English, Hindi, Kannada (interface). Menu item names are shown as entered.

## Not in v1 (later)

- Several billing counters sharing open tables live (v1 assumes one counter; bills from several counters still sync fine).
- Kitchen display screen, online orders (Swiggy/Zomato), inventory deduction, loyalty.
- Moving or merging tables, and splitting one table into two bills.

## Build order

1. Database: menu categories, items, tables, bills, bill items, payments (migration `0005`).
2. API: `/api/pos/config` (menu, tables, waiters, settings), `/api/pos/bills` (idempotent sync, re-check totals, update daily POS figures), and owner CRUD for menu and tables.
3. Shared bill maths with tests.
4. Admin app: **Manage → Menu** and **Manage → Tables**, and GST settings.
5. POS app: tables, order, pay, print, day summary, offline outbox.
6. Demo menu and tables in the demo seed, tests, screenshots.
