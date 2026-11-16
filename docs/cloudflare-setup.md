# Putting Mausam online with Cloudflare

> Doing this for the first time? [go-live-checklist.md](go-live-checklist.md) puts these steps in order with a tick box for each.

Mausam runs as one **Cloudflare Worker** called `mausam-admin`. You don't create the Worker by hand: you connect Cloudflare to the GitHub repo once, and Cloudflare builds and publishes the app itself, now and every time new code reaches the `main` branch. The same build also creates everything the app stores data in:

| What | Cloudflare product | Name it gets | Created by |
| --- | --- | --- | --- |
| The app, its API and the POS | Worker | `mausam-admin` | the first build |
| All the restaurant's data | D1 database | `mausam` | the first build |
| Tables inside the database | D1 migrations (`apps/api/migrations`) | — | every build |
| Photos and nightly backups | Workers KV namespace | `mausam-admin-files` | the first build |
| Login and API speed limits | Rate limiting | — | the first build |
| Overdue checks and backups | Cron trigger, every 15 minutes | — | the first build |

So there are **no database IDs to copy** into any file. `apps/api/wrangler.jsonc` leaves them out on purpose, and Wrangler (Cloudflare's deploy tool) creates the resources by name the first time and finds them by name after that.

Everything below is done in a web browser. You don't need to install anything. A laptop screen is easier for the Cloudflare dashboard, but a phone works. Plan about 30 minutes the first time. It's free: no card is needed.

**Who does what.** Every step in sections 1 to 7 needs your own Cloudflare, GitHub or Anthropic account, so only you can do them. The code side is finished and tested.

## 1. What you need

- A Cloudflare account. Sign up free at https://dash.cloudflare.com/sign-up and confirm your email. An account you already use for other things is fine, because everything here is new and named "mausam".
- The GitHub account that owns the `mausam` repo (`unbiddenautonomy`).
- Optional: an Anthropic account, only if you want the app to read photos of the handwritten closing memo.

## 2. Make a publishing token (5 minutes)

The build needs permission to create the database and update it. Cloudflare's ready-made Workers token doesn't include the database, so you add that one line.

1. Log in at https://dash.cloudflare.com.
2. Click your profile icon (top right) → **Profile** → **API Tokens** → **Create Token**. (If your dashboard shows **Manage account → Account API tokens** in the left menu instead, that works the same.)
3. Find **Edit Cloudflare Workers** and click **Use template**.
4. Under **Permissions**, click **+ Add more**, and in the three new boxes pick **Account** → **D1** → **Edit**.
5. Under **Account Resources**, choose **Include** → your account.
6. Under **Zone Resources**, choose **Include** → **All zones from an account** → your account. (This box must be filled even if you don't own a domain yet.)
7. Click **Continue to summary** → **Create Token**.

You don't need to copy the token. You'll pick it by name from a list in the next step. If you ever do copy it, keep it secret like a password.

## 3. Create the Worker from GitHub (10 minutes)

1. In the left menu, click **Compute (Workers)** → **Workers & Pages** (on some dashboards it's just **Workers & Pages**), then **Create application** (or **Create**).
2. Choose **Import a repository** (on some screens: **Continue with GitHub**).
3. Click **Connect GitHub**. A GitHub page opens: allow the **Cloudflare Workers and Pages** app to access the `mausam` repo ("Only select repositories" is fine). You're sent back.
4. Pick the `mausam` repo and fill in these fields exactly:

| Field | Value |
| --- | --- |
| Project name | `mausam-admin` (must be exactly this) |
| Production branch | `main` |
| Build command | `pnpm install --frozen-lockfile && pnpm build` |
| Deploy command | `pnpm release` |
| Root directory / Path | leave empty (or `/`) |

5. Open **Advanced settings** and set:

| Field | Value |
| --- | --- |
| API token | the token from step 2 |
| Builds for non-production branches | **off** (untick). The app is only published from `main`; GitHub already checks every pull request. |
| Build variables | add `NODE_VERSION` = `22` and `PNPM_VERSION` = `10.28.0` |

6. Click **Create and deploy** (or **Deploy**).

The first build takes 2 to 4 minutes. In the log you'll see it create the `mausam` database, the `mausam-admin-files` storage, publish the Worker, then apply 5 migrations (the tables). A line saying the first migration attempt failed is normal on the very first build: the database doesn't exist yet at that moment, so it's created by the deploy and the tables are added straight after.

When it says **Success**, the page shows your web address, like `https://mausam-admin.<your-subdomain>.workers.dev`. Cloudflare may ask you to choose the `<your-subdomain>` part the first time; any name is fine.

**If the build fails**, see [If something goes wrong](#if-something-goes-wrong). The fix for almost every first-build failure is picking the token from step 2 under **mausam-admin → Settings → Build → API token**, then **Retry build** from the **Deployments** tab.

## 4. Lock the first login (2 minutes, do this before opening the app)

Until the owner account exists, anyone who opens the web address could create it. A setup code stops that.

1. Open **Workers & Pages → mausam-admin → Settings → Variables and Secrets** → **Add**.
2. **Type**: **Secret** (not Text). **Variable name**: `SETUP_CODE`. **Value**: a code only you know. Click **Deploy** (or **Save and deploy**).

The first-run screen will ask for this code. Once the owner exists it's never used again. Secrets stay in place when new code is published, so you only do this once.

## 5. Turn on memo reading (optional)

The app can read the handwritten closing memo photo and fill in the numbers. It uses Claude, Anthropic's AI, which charges per use (roughly ₹2 to ₹5 per memo, at most 6 reads per day's memo).

1. At https://console.anthropic.com, make an account, add a little credit, and create an API key under **API keys**.
2. In Cloudflare: **mausam-admin → Settings → Variables and Secrets → Add**, **Type** **Secret**, **Variable name** `ANTHROPIC_API_KEY`, paste the key, **Deploy**.

Without it, everything else works and the "Read memo" button says it isn't set up.

Nothing else needs setting. The other settings (`BACKUP_DAYS`, `PHOTO_DAYS`, `MEMO_MODEL`, `ALLOWED_ORIGIN`) come from `apps/api/wrangler.jsonc` and are applied by each build. Don't add them in the dashboard, because the next build would overwrite them. Phone reminder keys are made by the app itself.

## 6. Check it works (3 minutes)

1. Open `https://<your address>/api/health`. It should show `{"ok":true,"migrations":5}`. The number grows as future updates add tables.
2. Open `https://<your address>/`. You should see the first-run screen asking for the setup code.
3. Open `https://<your address>/pos/`. You should see the POS login.
4. In Cloudflare, **Storage & Databases → D1** should list `mausam`, and **Storage & Databases → KV** should list `mausam-admin-files`.
5. **mausam-admin → Settings → Trigger events** (or **Triggers**) should show the cron `*/15 * * * *`.

## 7. First login and phones

1. On your phone, open the web address and create the owner account: your name, phone number, a 4-digit PIN, and the setup code.
2. **Manage → App users**: add each manager with their phone number, a PIN and their language.
3. **Manage → Staff**: add your staff. Leave pay blank if you don't know it yet.
4. On each manager's phone:
   - Open the address in Chrome, then **⋮ menu → Add to Home screen**.
   - **More → Turn on reminders**, allow notifications, and tap **Send a test**.
   - On Xiaomi, Oppo, Vivo and Realme phones also set **Settings → Battery → Chrome → No restrictions**, or reminders arrive late.
   - On iPhone use Safari: **Share → Add to Home Screen** (needs iOS 16.4 or newer).

## 8. Set up the billing counter (POS)

The POS is your address plus `/pos/`.

1. In the admin app, **Manage → Menu**: add categories and items with prices. Set GST under **Bills and GST** (GSTIN, rate, and whether prices include GST).
2. **Manage → Tables**: add your tables (for example area "Garden", first table "C1", 15 tables).
3. **Manage → App users**: add a user for the counter with the **staff** role. A cashier can bill but can't see reports or change settings.
4. On the counter PC, open `/pos/` in Chrome, log in as that user, and pick the counter letter (**A** for the first counter).
5. **Printing without a dialog:** make the receipt printer the Windows default printer, then make a Chrome shortcut whose target ends with:
   ```
   --kiosk --kiosk-printing https://<your address>/pos/
   ```
   Bills and kitchen tickets then print straight away on 80 mm paper. Alt+F4 leaves kiosk mode.
6. If the internet drops, keep billing. Bills are saved on the counter and sent when it's back. **Day summary** shows anything not sent yet.

## 9. Your own domain (optional)

The `.workers.dev` address works permanently, so this is only if you want a nicer one like `admin.mausam.in`.

1. Buy the domain (from Cloudflare under **Domain Registration**, or anywhere else).
2. If you bought it elsewhere, add it to Cloudflare (**Add a domain**, Free plan) and change the nameservers at your registrar to the two Cloudflare shows. This can take a few hours to go live.
3. **Workers & Pages → mausam-admin → Settings → Domains & Routes → Add → Custom domain**, enter `admin.mausam.in`. Cloudflare sets up the address and its certificate itself.

**Do this before the restaurant starts using the app, if you can.** Each address is a separate site to phones and browsers. After a switch, everyone logs in again, managers turn reminders on again and re-add the home-screen icon, and the counter PC opens the new `/pos/` address. Before switching the counter, check **Day summary** on the old address shows nothing unsent.

## 10. Updates

Nothing to do. When code is merged to `main`, Cloudflare builds and publishes it within a few minutes and applies any new tables on the way. Watch it under **mausam-admin → Deployments**. If an update breaks something, pick the previous version there and choose **Rollback**. (A rollback doesn't undo database changes; ask before rolling back an update that added tables.)

## Things to know

- **Free plan limits.** Workers, D1 and KV free allowances cover one restaurant comfortably. The one tight limit is 10 ms of computer time per request; PIN checking was tuned to fit it. If you ever see "Worker exceeded CPU time limit" (error 1102) in the logs, the $5/month Workers Paid plan removes it. Current limits: https://developers.cloudflare.com/workers/platform/pricing/
- **Backups, two layers:**
  - D1 Time Travel keeps 7 days of history on the free plan (30 on paid). Restore from **D1 → mausam → Time Travel**.
  - Every day after 4 am India time, the Worker writes a full copy as `backups/YYYY-MM-DD.json` in the `mausam-admin-files` KV storage and keeps 35 days. Login sessions aren't included, so after a restore everyone logs in again.
- **Restoring a nightly backup** (needs a computer with the code, see the last section):
  ```bash
  cd apps/api
  npx wrangler kv key get --binding FILES --remote backups/2026-11-14.json > backup.json
  node scripts/restore-backup.mjs backup.json > restore.sql
  npx wrangler d1 execute mausam --remote --file restore.sql
  ```
  This replaces all data with the backup. Download today's backup first, so you can undo.
- **Login protection:** 5 wrong PINs lock that account for 15 minutes, and one internet address can try at most 10 logins a minute.
- **Photos** are private and shown only to logged-in users. They live in Workers KV (free up to 1 GB, about a year of bill photos) and are deleted after 400 days so it never fills.
- **Demo data** is only for a developer's computer and never reaches the live database.

## If something goes wrong

| Problem | Fix |
| --- | --- |
| Build: "name in your Wrangler file must match the Worker" | The project must be called exactly `mausam-admin`. Delete it and import again with that name. |
| Build: D1, "Authentication error" or permissions error | Step 2 token needs **D1 · Edit**. Pick it under **Settings → Build → API token**, then **Retry build**. |
| Build: `pnpm: not found`, lockfile or Node version error | Check the build variables from step 3: `NODE_VERSION` = `22`, `PNPM_VERSION` = `10.28.0` (**Settings → Build → Variables**). |
| Red Cloudflare check on every pull request in GitHub | Builds for non-production branches is on. Turn it off under **Settings → Build → Branch control**. |
| `/api/health` says `"ok":false`, or login says "Something went wrong" | The tables are missing. **Retry build** on the latest deployment; it applies them. |
| First-run screen says the setup code is wrong | It must match the `SETUP_CODE` secret exactly. Set it again under **Settings → Variables and Secrets**. |
| You want to see errors as they happen | **mausam-admin → Observability → Logs**. |

## Publishing from a computer instead (optional, for a developer)

This does exactly what the automatic build does. It needs Node.js 22 or newer and Git.

```bash
git clone https://github.com/unbiddenautonomy/mausam && cd mausam
corepack enable            # gives you pnpm
pnpm install
cd apps/api && npx wrangler login && cd ../..   # opens the browser to sign in to Cloudflare
pnpm ship                  # build, create resources if needed, deploy, apply migrations
cd apps/api && npx wrangler secret put SETUP_CODE   # instead of step 4
```

On the first run from a computer, Wrangler may write the new database and storage IDs into `apps/api/wrangler.jsonc`. You can discard that change: it finds them by name either way.
