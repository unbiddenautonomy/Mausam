# Putting Mausam online with Cloudflare

> Doing this for the first time? [go-live-checklist.md](go-live-checklist.md) puts these steps in order and adds the checks.

Everything here is done in a web browser. You don't need to install anything, and no single computer is "the" Mausam computer. The code lives on GitHub. Cloudflare watches the GitHub repo and publishes the app by itself every time new code is pushed.

A laptop or desktop screen is easier for the Cloudflare dashboard, but a phone works too.

It takes about 20 minutes the first time. At the end you'll have one web address, such as `https://mausam-admin.<your-name>.workers.dev`, that serves both the app and its API. It's free to start. Cloudflare's $5/month plan is only needed once usage grows.

## 1. What you need

- A Cloudflare account. Sign up free at https://dash.cloudflare.com/sign-up. An account you already use for other projects is fine: everything below is new and named "mausam", so nothing else is touched.
- The GitHub account that holds the Mausam repo.

No card is needed. The database, photos and backups all fit in Cloudflare's free plan.

## 2. Make a publishing key (3 minutes)

Cloudflare needs permission to create the database and update it when the app changes.

1. Log in at https://dash.cloudflare.com and pick your account.
2. In the left menu, click **Manage account**, then **Account API tokens**, then **Create Token**.
3. Find the row **Edit Cloudflare Workers** and click **Use template**.
4. Under **Permissions**, click **+ Add more**. In the three boxes pick **Account**, then **D1**, then **Edit**.
5. Under **Account Resources**, choose your account.
6. Click **Continue to summary**, then **Create Token**.

You don't need to copy the token anywhere. You'll pick it from a list in the next step.

## 3. Create the app from GitHub (10 minutes)

1. In the left menu, click **Workers & Pages**, then the **Create** button.
2. Choose **Import a repository**. On some screens it's under **Continue with GitHub**.
3. Click **Connect GitHub**. A GitHub page opens. Allow Cloudflare to access the **Mausam** repo, and you're sent back.
4. Click **Mausam** in the list, and fill in these fields exactly:

| Field | Value |
| --- | --- |
| Project name | `mausam-admin` |
| Build command | `pnpm install --frozen-lockfile && pnpm build` |
| Deploy command | `pnpm release` |
| Root directory | leave empty |
| API token (under **Advanced settings**) | the token you made in step 2 |

5. Click **Create and deploy**.

The first build takes 2 to 3 minutes. It creates the `mausam` database and its tables, and the storage for photos and backups. When it says **Success**, the page shows your web address, ending in `.workers.dev`.

**If the first build fails** with a permissions or D1 error, the token wasn't picked. Open **mausam-admin → Settings → Build → API token**, choose the token from step 2, then retry the build from the **Deployments** tab.

## 4. Turn on memo reading (optional)

The app can read the handwritten closing memo photo and fill in the numbers. It uses Claude, Anthropic's AI, which charges per use (roughly ₹2 to ₹5 per memo). Each day's memo can be read at most 6 times, so costs stay small.

1. Make an account at console.anthropic.com, add a little credit, and create an API key.
2. In Cloudflare, open **mausam-admin → Settings → Variables and Secrets**, then click **Add**.
3. Set **Type** to **Secret**, **Variable name** to `ANTHROPIC_API_KEY`, and paste the key as the value. Click **Deploy**.

Without this key, everything else works and the "Read memo" button just says it isn't set up.

## 5. Protect the first login (recommended)

Until the owner account exists, anyone who opens the web address could create it. To stop that, add a setup code before you open the app:

1. Open **mausam-admin → Settings → Variables and Secrets**, then click **Add**.
2. Set **Type** to **Secret**, **Variable name** to `SETUP_CODE`, and type a code only you know. Click **Deploy**.

The first-run screen will then ask for it. Once the owner exists, the code isn't used again.

## 6. First login

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

Phone reminders need no setup. The app makes its own reminder keys the first time someone turns them on.

## 7. Set up the billing counter (POS)

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

## 8. Updates

There's nothing to do. When new code is pushed to the `main` branch on GitHub, Cloudflare builds and publishes it within a few minutes, and applies any database changes on the way. You can watch it under **mausam-admin → Deployments**.

If an update ever breaks something, open **Deployments**, find the previous version, and choose **Rollback**.

## 9. Using your own domain later (optional)

Once you buy a domain (for example `mausam.in`), add it to Cloudflare. Then go to **Workers & Pages → mausam-admin → Settings → Domains & Routes → Add custom domain**, and enter `admin.mausam.in`.

## Things to know

- **Backups, two layers:**
  - D1 Time Travel keeps 30 days of history (7 days on the free plan). Restore from **D1 → mausam → Time Travel**, or `npx wrangler d1 time-travel restore mausam --timestamp=<ISO time>`.
  - Every day after 4 am India time, the Worker writes a full copy as `backups/YYYY-MM-DD.json` in its file storage (Workers KV) and keeps 35 days (`BACKUP_DAYS` in `wrangler.jsonc`). Login sessions aren't included, so after a restore everyone logs in again.
- **Restoring a nightly backup:**
  ```bash
  cd apps/api
  npx wrangler kv key get --binding FILES --remote backups/2026-11-14.json > backup.json
  node scripts/restore-backup.mjs backup.json > restore.sql
  npx wrangler d1 execute mausam --remote --file restore.sql
  ```
  This replaces all data with the backup. To be safe, download today's backup first, so you can undo.
- **Login protection:** 5 wrong PINs lock that account for 15 minutes, and one internet address can try at most 10 logins a minute.
- **Photos** are private and only shown to logged-in users. They are kept in Workers KV, which is free up to 1 GB, about a year of bill photos. Photos older than 400 days are deleted by themselves so the space never fills (`PHOTO_DAYS` in `wrangler.jsonc`). If you ever want to keep them longer, ask for them to be moved to R2, which needs a card.
- **Reminders:** the app checks for overdue reports every 15 minutes, using the `triggers.crons` setting in `apps/api/wrangler.jsonc`.
- **Costs:** Workers, D1 and KV all have free allowances that should cover a single restaurant, with no card on file. Check https://developers.cloudflare.com/workers/platform/pricing/ for current limits.
- **Demo data** is only for trying the app on a developer's computer. It is never sent to the live database.

## If something goes wrong

| Problem | Fix |
| --- | --- |
| Build says the name in the Wrangler file must match the Worker | The project must be called exactly `mausam-admin`. |
| Build fails with a D1 or permissions error | Step 2 and the last part of step 3: make the token with **D1 · Edit** and pick it under **Settings → Build → API token**. |
| The app opens, but login says "Something went wrong" | The tables are missing. Retry the latest build under **Deployments**. It creates them. |
| You want to see errors as they happen | **mausam-admin → Observability → Logs** shows the live logs. |
| First-run screen says the setup code is wrong | It must match the `SETUP_CODE` secret exactly. Set it again under **Settings → Variables and Secrets**. |
| `/api/health` says `"ok": false` | The database isn't reachable or has no tables. Retry the latest build under **Deployments**. |

## Publishing from a computer instead (optional)

A developer can also publish from their own computer. This is the same thing the automatic build does. From the repo root, after `pnpm install`:

```bash
cd apps/api && npx wrangler login && cd ../..
pnpm ship
```
