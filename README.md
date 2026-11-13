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

## What's built and what's next

**Built:**
- Phone + PIN login, with owner and manager roles.
- Today's task list.
- Morning shopping: cash taken, bills with photos, cash returned, and the gap check.
- Expenses, with categories, photos, and no-bill tracking.
- Close the day: memo photo and live checks.
- Past closings.
- Alerts:
  - a closing missing by 10 am;
  - shopping still open by 1 pm;
  - a closing that was flagged;
  - an expense category far above its usual amount.
- Owner overview.
- Reports: sales trend, expenses by category, cash vs online, and on-time reporting.
- Manage pages: users, staff (pay can be left blank), categories, and reminder times.
- English, Hindi and Kannada.
- Works offline: entries wait on the phone and send when the phone is back online.

**Next:**
1. Push notifications sent from the Worker (the app already receives them and shows a badge).
2. Reading the handwritten memo with AI, and checking it against what the manager typed.
3. Attendance, advances and month-end pay.
4. Vendors and deliveries.
5. Month close (27th to 3rd).
6. Importing Excel exports from the current POS.
