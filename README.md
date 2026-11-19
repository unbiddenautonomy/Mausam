# Mausam

Admin app for Mausam Restaurant: managers log morning shopping, expenses and the nightly closing on their phones, and the owner sees the numbers, flags and reports. The touchscreen POS for the billing counter is in the same repo.

## What's in the repo

| Folder | What it is |
| --- | --- |
| `apps/admin` | The web app (React + Vite). Works on phones and desktops, and can be installed to the home screen. |
| `apps/api` | The API on a Cloudflare Worker (Hono), with the D1 database and KV storage for photos and backups. In production this same Worker also serves the admin app. |
| `apps/pos` | The touchscreen POS for the billing counter (React + Vite), served at `/pos/`. Works offline and syncs bills. |
| `packages/shared` | Code both apps use: money and date rules, closing checks, and the English, Hindi and Kannada text. |
| `docs/` | Setup guide and notes. Start with [docs/how-to-use.md](docs/how-to-use.md) for how to use the admin app and the POS day to day. |

## Run it on your computer

You need [Node.js 22+](https://nodejs.org) and pnpm (`npm install -g pnpm`).

```bash
pnpm install
pnpm setup:local                          # builds the app and creates the local database
pnpm --filter @mausam/api db:seed:demo    # optional: 5 weeks of demo data
pnpm dev:api                              # terminal 1: API on http://localhost:8787
pnpm dev:admin                            # terminal 2: app on http://localhost:5173
pnpm dev:pos                              # optional, terminal 3: POS on http://localhost:5174/pos/
```

Open http://localhost:5173 on your computer, or `http://<your-computer's-IP>:5173` on a phone on the same Wi-Fi.

- **Without demo data**, the first screen asks you to create the owner account.
- **With demo data**, log in as owner `9000000001` / PIN `1234`, or as a manager `9000000002` / PIN `1111`. On the POS, use the counter login `9000000004` / PIN `2222`.

Run the tests with `pnpm test`, the type checks with `pnpm typecheck`, and the linter with `pnpm lint`. `pnpm check` runs everything GitHub's check would (types, tests, build and a Worker dry run).

GitHub checks only run when started by hand, so switch on the local pre-push check once per clone with `pnpm hooks:install`. Every `git push` then runs lint, typecheck and tests first (`git push --no-verify` skips it once).

## Put it online

Cloudflare connects to this GitHub repo and publishes the app every time code is pushed to `main`, so no particular computer is needed. Set it up once from a browser by following [docs/cloudflare-setup.md](docs/cloudflare-setup.md). Database changes in `apps/api/migrations` are applied automatically as part of each publish.

GitHub also checks every pull request (types, tests, build). The UI rules and next improvements are in [docs/ui-plan.md](docs/ui-plan.md).

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
- Phone reminders (Web Push) and alerts. Each reminder goes to the people picked in **Manage → Settings** (for example, shopping to the head manager and closing to the assistant manager); with nobody picked, every manager gets it.
  - a closing missing by 10 am;
  - shopping still open by 1 pm;
  - attendance not marked for yesterday;
  - a closing that was flagged;
  - a closing memo that doesn't add up (it's still accepted, and the owner and every manager get an alert);
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

**Touchscreen POS (`apps/pos`):**
- Made for a touch PC or tablet, landscape or upright. Everything is a big button: waiters, table numbers and cash use on-screen number pads, so no keyboard is needed.
- **No table map by default:** "New table order" asks who is serving and (optionally) the table number, and open orders are listed by order number. The table map (areas, Free / Ordering / Bill given colours) can be switched on in **Manage → POS options**.
- **A waiter on every table order:** the waiter is picked from big buttons with their ID, and payment isn't taken until one is picked (parcels don't need one).
- **No printer needed:** the kitchen order and the bill are shown on screen, and after payment the screen shows "Paid" with the change to give back. If a receipt printer is added later, switch it on in POS options and the same buttons print.
- **No GST by default:** GST, CGST/SGST and the GSTIN stay in the code and come back when switched on.
- Big item buttons by category, favourites and search; + / − and kitchen notes on each line. Parcels get token numbers.
- Discounts, cancel with a reason, and payment by cash (with change to give back), UPI, card, or split.
- Works with no internet: bills are numbered on the counter (e.g. `A2627-00042`) and sent when online. Re-sending is harmless.
- Synced bills fill in the day's POS figures, so the closing check and the sales and best-seller reports use them directly.
- Day summary with sales by payment mode and by waiter.
- Admin pages: **Manage → Menu**, **Manage → Waiters** (ID and commission %), **Manage → POS options**, **Manage → Tables**, **POS bills**, and **Reports → Waiters**.
- See [docs/pos-plan.md](docs/pos-plan.md) for the design and what's next.

**Waiter commission:**
- Each waiter gets a % of the paid bills they served, before GST. There's one default % for everyone, and a waiter can have their own.
- The rate is saved on each bill when it reaches the server, so changing a % later doesn't change past months.
- **Reports → Waiters** shows each waiter's bills, sales and commission for a month, with a day-by-day breakdown, or for a single day.
- Month-end pay adds the commission on top of the waiter's pay (and works for waiters with no fixed pay).

## Optional features

- **Phone reminders** work with no setup. The Worker makes its own reminder (VAPID) keys the first time someone turns reminders on, and keeps them in the database. To use your own keys instead, set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` on the Worker; `node apps/api/scripts/vapid-keys.mjs` makes a pair.
- **Memo reading** works with no setup. Without a key, the manager's phone reads the memo photo itself with free OCR (Tesseract.js, English + Kannada), served from the app's own `/ocr/` path. It's free and works offline after the first use (about 9 MB, once), but it often misreads handwriting, so the numbers are only suggestions and the screen shows what it read. Adding an Anthropic API key as a Worker secret named `ANTHROPIC_API_KEY` (step 7 of the setup guide) switches the server to Claude, which reads handwriting far better; the phone reader stays as a backup if Claude fails.
- **Setup code:** a `SETUP_CODE` secret protects the first-run owner screen (section 6 of the setup guide). For local secrets, copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars`.

## Safety built in

- Logins: PINs are hashed; 5 wrong tries lock an account for 15 minutes (twice as long each time after that, up to a day, and the owner gets an alert), and one address can try 10 logins a minute.
- Nightly database backup to KV storage (35 days kept), plus D1 Time Travel. Restore steps are in the setup guide.
- Security headers on the app and API, no cross-site API access by default, and request logs in the Cloudflare dashboard.

## Database changes

New tables and columns are in `apps/api/migrations` (`0001` to `0011`). `pnpm --filter @mausam/api db:migrate:local` applies them on your computer. Online, each publish applies them automatically (`pnpm release`).
