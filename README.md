# Mausam

Admin app for Mausam Restaurant: managers log morning shopping, expenses and the nightly closing on their phones, and the owner sees the numbers, flags and reports. A touchscreen POS will be added to this same repo later.

## What's in the repo

| Folder | What it is |
| --- | --- |
| `apps/admin` | The web app (React + Vite). Works on phones and desktops, and can be installed to the home screen. |
| `apps/api` | The API on a Cloudflare Worker (Hono), with the D1 database and R2 photo storage. In production this same Worker also serves the admin app. |
| `apps/pos` | Later: the touchscreen POS. |
| `packages/shared` | Code both apps use: money and date rules, closing checks, and the English, Hindi and Kannada text. |
| `docs/` | Setup guide and notes. |

## Run it on your computer

You need [Node.js 22+](https://nodejs.org) and pnpm (`npm install -g pnpm`).

```bash
pnpm install
pnpm setup:local                          # builds the app and creates the local database
pnpm --filter @mausam/api db:seed:demo    # optional: 5 weeks of demo data
pnpm dev:api                              # terminal 1: API on http://localhost:8787
pnpm dev:admin                            # terminal 2: app on http://localhost:5173
```

Open http://localhost:5173 on your computer, or `http://<your-computer's-IP>:5173` on a phone on the same Wi-Fi.

- **Without demo data**, the first screen asks you to create the owner account.
- **With demo data**, log in as owner `9000000001` / PIN `1234`, or as a manager `9000000002` / PIN `1111`.

Run the tests with `pnpm test`, and the type checks with `pnpm typecheck`.

## Put it online

Follow [docs/cloudflare-setup.md](docs/cloudflare-setup.md).

## How the money works

- **The formula:** cash left in the drawer + online + expenses paid from the counter = total counter. The app checks this on every closing.
- **Business day:** runs 5 am to 5 am India time, so a 1:30 am closing counts for the day before.
- **Locking:** a day locks at 11 am the next morning. After that, only the owner can change it.
- **Audit:** every change is recorded, with who made it and when.

## What's built

**Daily work (managers and owner):**
- Phone + PIN login, with owner and manager roles.
- Today's task list.
- Morning shopping: cash taken, bills with photos, cash returned, and the gap check.
- Expenses, with categories, photos, no-bill tracking, and an optional item + quantity for price tracking.
- Close the day: memo photo, live checks, and the POS total filled in when it has been imported.
- Reading the handwritten memo with AI and comparing it with what was typed (up to 6 reads a day).
- Attendance (present, half day, absent, leave) and advances paid from the counter.
- Vendors: agreed rates, expected deliveries, deliveries, payments and what we owe. A delivery charged above the agreed rate raises an alert.
- Phone reminders (Web Push) and alerts:
  - a closing missing by 10 am;
  - shopping still open by 1 pm;
  - attendance not marked for yesterday;
  - a closing that was flagged;
  - an expense category far above its usual amount;
  - a vendor rate above the deal.
- English, Hindi and Kannada.
- Works offline: entries wait on the phone and send when the phone is back online.

**Owner only:**
- Overview, and reports:
  - sales trend and sales by weekday;
  - expenses by category;
  - cash vs online;
  - on-time reporting;
  - costs and profit (food cost %, wages %, what's left);
  - best sellers;
  - price watch.
- Month-end pay: days worked, advances, adjustments, and mark as paid.
- Month close (27th to 3rd): checklist, monthly bills, tally comparison, print, and lock. A closed month is locked for everyone until it is reopened.
- Import daily sales and item sales from the POS's Excel or CSV export. The column matching is remembered.
- Change history: who changed what, and when.
- Manage pages: users, staff (pay can be left blank), categories, and reminder times.

**Next:** the touchscreen POS in `apps/pos`.

## Optional features that need keys

- **Phone reminders:** run `node apps/api/scripts/vapid-keys.mjs` once, then follow section 5 of the setup guide.
- **Memo reading:** add an Anthropic API key as a Worker secret (section 6 of the setup guide). Without it, the memo button explains that it's off.

## Database changes

New tables and columns are in `apps/api/migrations` (`0001` to `0004`). `pnpm --filter @mausam/api db:migrate:local` applies them on your computer, and the setup guide has the command for Cloudflare.
