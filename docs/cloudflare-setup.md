# Putting Mausam online with Cloudflare

> Doing this for the first time? Follow [go-live-checklist.md](go-live-checklist.md); it puts these steps in order and adds the checks.

This takes about 30 minutes the first time. You do it once; after that, publishing an update is a single command.

At the end you'll have one web address, such as `https://mausam-admin.<your-name>.workers.dev`, that serves both the app and its API. It's free to start. Cloudflare's $5/month plan is only needed once usage grows.

## 1. What you need

- A Cloudflare account. Sign up free at https://dash.cloudflare.com/sign-up.
- This repo on your computer, with `pnpm install` already run (see the README).

## 2. Log in to Cloudflare from your computer

```bash
cd apps/api
npx wrangler login
```

A browser window opens. Click **Allow**.

## 3. Create the database

```bash
npx wrangler d1 create mausam
```

It prints a block that includes `"database_id": "…"`. Copy that id into `apps/api/wrangler.jsonc`, replacing `00000000-0000-0000-0000-000000000000`.

Then create the tables:

```bash
npx wrangler d1 migrations apply mausam --remote
```

Answer **y** when it asks.

**Never** run `db:seed:demo` against the remote database. The demo data is for your computer only.

## 4. Create photo storage

R2 has to be turned on once before you can use it. In the Cloudflare dashboard, open **R2 Object Storage** and click **Purchase / Enable**. It's free up to 10 GB, though it may ask for a card.

Then:

```bash
npx wrangler r2 bucket create mausam-photos
```

## 5. Turn on phone reminders

Reminders are sent as phone notifications. They need a pair of keys, which you make once.

```bash
cd apps/api
node scripts/vapid-keys.mjs
```

It prints two lines.

1. Copy the **public key** into `apps/api/wrangler.jsonc`, in `"VAPID_PUBLIC_KEY": ""`, between the quotes.
2. In the same file, change `"VAPID_SUBJECT"` to your own email, written as `mailto:you@example.com`. Push services only use it to contact you if something goes wrong.
3. Save the **private key** as a secret. It's never written in a file:

```bash
npx wrangler secret put VAPID_PRIVATE_KEY
```

Paste the private key when it asks. Keep a copy in a password manager. If you ever make new keys, every phone has to turn reminders on again.

## 6. Turn on memo reading (optional)

The app can read the handwritten closing memo photo and fill in the numbers. It uses Claude, Anthropic's AI, which charges per use (roughly ₹2 to ₹5 per memo). Each day's memo can be read at most 6 times, so costs stay small.

1. Make an account at console.anthropic.com, add a little credit, and create an API key.
2. Save it as a secret:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

Without this key, everything else works and the "Read memo" button just says it isn't set up.

## 6b. Protect the first login (recommended)

Until the owner account exists, anyone who opens the web address could create it. Pick a setup code and save it as a secret:

```bash
npx wrangler secret put SETUP_CODE
```

The first-run screen will then ask for it. Once the owner exists, the code isn't used again.

## 7. Publish

From the repo root:

```bash
pnpm ship
```

This builds the app and uploads it. At the end, it prints your web address. Secrets you saved earlier stay in place.

## 8. First login

1. Open the web address on your phone.
2. Create the owner account: your name, phone number, and a 4-digit PIN.
3. Go to **Manage → App users** and add each manager with their phone number, a PIN, and their language.
4. Go to **Manage → Staff** and add your staff. Leave pay blank if you don't know it yet.
5. On each manager's phone:
   - Open the address in Chrome.
   - Tap the **⋮ menu → Add to Home screen**.
   - Open **More → Turn on reminders** and allow notifications. Tap **Send a test** to check it works.
   - On Xiaomi, Oppo, Vivo and Realme phones, also go to **Settings → Battery → Chrome → No restrictions**. Otherwise reminders can arrive late.
   - On iPhone, use Safari: tap **Share → Add to Home Screen**. This needs iOS 16.4 or newer.

## 8b. Set up the billing counter (POS)

The POS is at the same address plus `/pos/`, for example `https://mausam-admin.<your-name>.workers.dev/pos/`.

1. In the admin app, open **Manage → Menu** and add your categories and items with prices. Set GST under **Bills and GST** (GSTIN, rate, and whether prices include GST).
2. Open **Manage → Tables** and add your tables. For example, area "Garden", first table "C1", 15 tables.
3. Open **Manage → App users** and add a user for the counter with the **staff** role. A cashier can then bill, but can't see reports or change settings.
4. On the counter PC, open the `/pos/` address in Chrome, log in with that user, and pick the counter letter (**A** for the first counter).
5. **Printing without a dialog:** set the receipt printer as the Windows default printer. Then make a Chrome shortcut for the POS with these extra options in its target:
   ```
   --kiosk --kiosk-printing https://<your address>/pos/
   ```
   Bills and kitchen tickets then print straight away on 80 mm paper. To leave kiosk mode, press Alt+F4.
6. If the internet drops, keep billing. Bills are saved on the counter and sent automatically when it's back. The **Day summary** screen shows anything not sent yet.

## 9. Publishing updates later

```bash
git pull
pnpm install
pnpm --filter @mausam/api db:migrate:remote   # only when a new file was added to apps/api/migrations
pnpm ship
```

Or let GitHub do it: see section 4 of the [go-live checklist](go-live-checklist.md). The **Deploy** workflow applies database changes and publishes whenever you run it (or on every merge to `main`, if you turn that on).

## 10. Using your own domain later (optional)

Once you buy a domain (for example `mausam.in`), add it to Cloudflare. Then go to **Workers & Pages → mausam-admin → Settings → Domains & Routes → Add custom domain**, and enter `admin.mausam.in`.

## Things to know

- **Backups, two layers:**
  - D1 Time Travel keeps 30 days of history (7 days on the free plan). Restore from **D1 → mausam → Time Travel**, or `npx wrangler d1 time-travel restore mausam --timestamp=<ISO time>`.
  - Every day after 4 am India time, the Worker writes a full copy to R2 as `backups/YYYY-MM-DD.json` and keeps 35 days (`BACKUP_DAYS` in `wrangler.jsonc`). Login sessions aren't included, so after a restore everyone logs in again.
- **Restoring a nightly backup:**
  ```bash
  cd apps/api
  npx wrangler r2 object get mausam-photos/backups/2026-11-14.json --remote --file backup.json
  node scripts/restore-backup.mjs backup.json > restore.sql
  npx wrangler d1 execute mausam --remote --file restore.sql
  ```
  This replaces all data with the backup. To be safe, download today's backup first, so you can undo.
- **Login protection:** 5 wrong PINs lock that account for 15 minutes, and one internet address can try at most 10 logins a minute.
- **Photos** are private and only shown to logged-in users.
- **Reminders:** the Worker checks for overdue reports every 15 minutes, using the `triggers.crons` setting in `wrangler.jsonc`.
- **Costs:** Workers, D1 and R2 all have free allowances that should cover a single restaurant at first. Check https://developers.cloudflare.com/workers/platform/pricing/ for current limits.

## If something goes wrong

| Problem | Fix |
| --- | --- |
| `database_id` error when publishing | Step 3: paste the id from `wrangler d1 create` into `wrangler.jsonc`. |
| `R2 bucket not found` | Step 4: create the `mausam-photos` bucket, with exactly that name. |
| The app opens, but login says "Something went wrong" | The tables are missing. Run `pnpm --filter @mausam/api db:migrate:remote`. |
| `Assets directory does not exist` | Run `pnpm build` first. `pnpm ship` does this for you. |
| You want to see errors as they happen | `cd apps/api && npx wrangler tail` streams the live logs, or open **Workers & Pages → mausam-admin → Logs**. |
| First-run screen says the setup code is wrong | It must match the `SETUP_CODE` secret exactly. Set it again with `npx wrangler secret put SETUP_CODE`. |
| Deploy workflow fails on "placeholder database id" | Commit the real `database_id` in `apps/api/wrangler.jsonc`. |
| `/api/health` says `"ok": false` | The database isn't reachable or has no tables. Run `pnpm --filter @mausam/api db:migrate:remote`. |
