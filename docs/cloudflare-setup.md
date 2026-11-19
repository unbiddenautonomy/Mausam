# Putting Mausam online with Cloudflare

This is the whole setup, start to finish, in one list. Do the steps in order. After each step, **You should see** tells you what's on screen when it worked. If it doesn't match, look in [If something goes wrong](#if-something-goes-wrong) at the end.

Everything happens in a web browser. A laptop is easier than a phone for the Cloudflare part. Plan about 30 minutes. It's free, and no card is needed.

**How it works, in one paragraph.** Mausam runs on Cloudflare as one "Worker" called `mausam-admin`. You don't build it by hand. You connect Cloudflare to the `mausam` repo on GitHub, and Cloudflare builds the app and publishes it. That first build also creates the database (`mausam`), the storage for photos and backups (`mausam-admin-files`), and all the tables. There are no IDs to copy anywhere. Every later change merged into `main` on GitHub is published the same way, automatically.

---

## Part 1: Cloudflare (about 20 minutes)

### Step 1. Make a Cloudflare account

1. Go to https://dash.cloudflare.com/sign-up and sign up with your email.
2. Open the email Cloudflare sends and click the link to confirm it.

If you already have a Cloudflare account, use it. Nothing else in it is touched.

**You should see:** the Cloudflare dashboard, with your account name at the top left.

### Step 2. Connect the GitHub repo

1. Click the **Cloudflare logo** (top left) to go back to your account.
2. In the left menu, click **Compute (Workers)** → **Workers & Pages**. (Some dashboards show **Workers & Pages** directly.)
3. Click **Create application** (or **Create**).
4. Click **Import a repository**, or **Continue with GitHub** if that's what you see.
5. If GitHub isn't connected yet, click **Connect GitHub**. A GitHub page opens:
   - Choose the account `unbiddenautonomy`.
   - Choose **Only select repositories**, pick `mausam`, and click **Install & Authorize** (or **Save**).
   - You're sent back to Cloudflare.
6. Click `mausam` in the list of repos, then **Next** (or **Begin setup**).

**You should see:** a page titled something like **Set up your application**, with a project name box and build boxes.

### Step 3. Fill in the build settings

Type these exactly. Copy and paste is safest.

| Box | What to put |
| --- | --- |
| **Project name** | `mausam-admin` |
| **Build command** | `pnpm install --frozen-lockfile && pnpm build` |
| **Deploy command** | `pnpm release` |
| **Root directory** (or **Path**) | leave it as it is (empty or `/`) |

Then click **Advanced settings** to open more boxes:

| Box | What to put |
| --- | --- |
| **API token** | choose **Create new token**. Cloudflare makes one for the build. |
| **Non-production branch deploy command**, or a tick box about **builds for non-production branches** | if there's a tick box, untick it. If there's only a command box, leave it; you'll turn preview builds off in step 5. |
| **Build variables** | nothing needed |

Click **Deploy** (or **Save and Deploy**).

**You should see:** a build log scrolling. It takes 2 to 4 minutes. Don't close the page; it's fine if you do, though, because the build keeps going.

### Step 4. Check the first build

When the build finishes, it shows **Success** with a green tick, and a web address like:

```
https://mausam-admin.<something>.workers.dev
```

Write this address down. It's the app's address from now on.

If Cloudflare asks you to pick a **workers.dev subdomain** first, type any short name (for example `mausam`). That becomes the `<something>` part.

In the log you'll see lines like these, in this order. They're normal:

1. A first `migrations apply` attempt that says it couldn't find the database, then `release: no database yet (first publish)`. This is expected on the very first build only.
2. `Creating new D1 Database "mausam"` and `Creating new KV Namespace "mausam-admin-files"`.
3. `Deployed mausam-admin`.
4. Eleven migrations applied, `0001_init.sql` to `0011_indexes.sql`, each with a ✅.

On every later build the order is: migrations first, then the deploy. If a migration fails, the log ends with `release: the database changes failed, so nothing was published`, and the app that was already online keeps running unchanged.

**If it says Failed** and the last red lines mention `D1` or a permission error, the token Cloudflare made can't create the database yet. Do [Adding the database permission](#adding-the-database-permission), then come back. For any other failure, look up the last red lines of the log and find them in [If something goes wrong](#if-something-goes-wrong).

### Step 5. Turn off preview builds

Without this, Cloudflare also tries to build every work-in-progress branch on GitHub. Those builds fail, and they put a red mark on pull requests.

1. Open **Workers & Pages** → click **mausam-admin** → **Settings** tab.
2. Find the **Build** section, then **Branch control**.
3. Check **Production branch** is `main`.
4. Untick **Enable Preview Builds** (it may be called **Builds for non-production branches**). Click **Save**.

**You should see:** Branch control showing `main` with preview builds off.

### Step 6. Add the setup code (do this before anyone opens the app)

Until the owner account exists, anyone who finds the web address could create it. The setup code stops that. The app won't let anyone create the owner account online until this secret exists.

1. Still in **mausam-admin → Settings**, find **Variables and Secrets** and click **+ Add**.
2. **Type**: choose **Secret**, not Text.
3. **Variable name**: `SETUP_CODE`
4. **Value**: a code only you know, for example 6 to 10 letters and numbers. Save it in your phone's notes or password manager.
5. Click **Deploy** (or **Save and deploy**).

**You should see:** `SETUP_CODE` in the list, with its value hidden. Secrets stay when new code is published, so this is one-time.

Don't add anything else here. `BACKUP_DAYS`, `PHOTO_DAYS`, `MEMO_MODEL` and `ALLOWED_ORIGIN` already come from the code, and phone reminder keys are made by the app itself.

### Step 7. Memo reading (optional, can be done any time)

The app reads the photo of the handwritten closing memo and suggests the numbers, with nothing to set up: the manager's phone reads it with free OCR. That's free but often misreads handwriting. This step switches memo reading to Claude, Anthropic's AI, which reads handwriting much better and costs roughly ₹2 to ₹5 per memo. Skip it if you don't want it; the free reader keeps working.

1. At https://console.anthropic.com, make an account and add a little credit under **Billing**.
2. Under **API keys**, click **Create key** and copy it.
3. In Cloudflare, **mausam-admin → Settings → Variables and Secrets → + Add**. **Type** **Secret**, **Variable name** `ANTHROPIC_API_KEY`, paste the key as the value, click **Deploy**.

**You should see:** `ANTHROPIC_API_KEY` in the list next to `SETUP_CODE`.

### Step 8. Check that everything works

Open each of these in your browser, using your address from step 4:

| Open | You should see |
| --- | --- |
| `https://<your address>/api/health` | `{"ok":true,"migrations":5}` |
| `https://<your address>/` | the Mausam first-run screen, asking for your name, phone, PIN and setup code |
| `https://<your address>/pos/` | the POS login screen |

In the Cloudflare dashboard you can also see what was created. Under **Storage & Databases → D1 SQL Database** there's `mausam`, and under **Storage & Databases → Workers KV** there's `mausam-admin-files`.

Cloudflare is done.

---

## Part 2: Start using the app (about 10 minutes)

### Step 9. Create the owner account

Do this straight after step 8.

1. On your phone, open your address.
2. Enter your name, your phone number, a 4-digit PIN, and the setup code from step 6.
3. Tap to create the account.

**You should see:** the owner's **Today** screen.

### Step 10. Add managers and employees

1. **Manage → App users**: add each person who uses the app, with their phone number, a 4-digit PIN and their language, and tell each one their PIN. Everyone uses the same address, and what they see depends on their role:
   - **Owner**: everything, including reports, pay and settings.
   - **Manager**: entries (shopping, expenses, closing the day), attendance and advances, vendors, alerts, bills, and the basic reports (sales, cash and online, expenses). The deeper analytics only when the owner shares them for the month.
   - **Employee**: uses only the POS at the counter. If an employee opens the admin app, it sends them to the POS.
2. **Manage → Staff**: add your staff. Leave pay blank if you don't know it yet.

### Step 11. Set up each manager's phone

On each manager's phone:

1. Open your address in **Chrome** and log in with their phone number and PIN.
2. Tap **⋮** (top right) → **Add to Home screen**.
3. In the app, open **More → Turn on reminders** and allow notifications. Tap **Send a test**; a notification should appear.
4. On Xiaomi, Oppo, Vivo and Realme phones, also open the phone's **Settings → Battery → Chrome → No restrictions**, or reminders arrive late.

On an iPhone, use **Safari**: **Share → Add to Home Screen**, then open the app from the home screen and turn on reminders. This needs iOS 16.4 or newer.

### Step 12. Set up the billing counter (POS)

1. In the admin app, **Manage → Menu**: add categories and items with prices. In **Manage → POS options**, set the bill heading and footer, and GST if you charge it.
2. **Manage → Tables**: tables T1 to T22 are already there. Rename, add or remove them to match your floor.
3. **Manage → App users**: add a user for each person who bills at the counter, with the **Employee** role. Employees can only use the POS.
4. On the counter PC, open `https://<your address>/pos/` in Chrome, log in as that user, and pick counter **A**.
5. To print without a pop-up each time: make the receipt printer the Windows default printer. Then right-click the desktop → **New → Shortcut**, and use this as the location:
   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --kiosk-printing https://<your address>/pos/
   ```
   Open the POS from that shortcut. Bills print straight away on 80 mm paper. Press Alt+F4 to leave. The full printer setup is in [pos-printing.md](pos-printing.md).

If the internet drops, keep billing. Bills are saved on the counter and sent when it's back. **Day summary** shows anything not sent yet.

### Step 13. In the first week

- **The morning after launch**, check the nightly backup ran: **Storage & Databases → Workers KV → mausam-admin-files → KV Pairs** should have `backups/<today's date>.json`.
- **If something looks wrong**, **mausam-admin → Observability → Logs** shows each request and any errors.
- Ask a native Hindi speaker and a native Kannada speaker to click through the app for 15 minutes each. The translations are first drafts.

---

## Later

### Updates

Nothing to do. When a change is merged into `main` on GitHub, Cloudflare builds and publishes it within a few minutes, and adds any new tables on the way. You can watch it under **mausam-admin → Deployments**.

If an update breaks something, open **Deployments**, find the version before it, and choose **Rollback**. A rollback doesn't undo database changes, so ask first if that update added tables.

### Your own domain (optional)

The `.workers.dev` address works permanently. A domain is only if you want a nicer address like `admin.mausam.in`.

1. Buy the domain. The easiest place is Cloudflare itself: **Domain Registration → Register Domains**. If you buy it somewhere else, add it under **Add a domain** (Free plan) and change the nameservers at the seller to the two Cloudflare shows. That can take a few hours.
2. **mausam-admin → Settings → Domains & Routes → + Add → Custom domain**, type `admin.mausam.in`, and click **Add domain**. Cloudflare sets up the address and its certificate itself.

**If you can, do this before the restaurant starts using the app.** To phones and browsers, a new address is a new site. After a switch, everyone logs in again, managers turn reminders on again and re-add the home-screen icon, and the counter PC uses the new `/pos/` address. Before switching the counter, check **Day summary** on the old address shows nothing unsent.

### Backups

There are two layers:

- **D1 Time Travel** keeps 7 days of history on the free plan (30 days on the paid plan). Restore from **Storage & Databases → D1 → mausam → Time Travel**.
- **A nightly copy.** Every day after 4 am India time, the app saves the whole database as `backups/YYYY-MM-DD.json` in `mausam-admin-files` and keeps 35 days. Login sessions aren't included, so after a restore everyone logs in again.

Restoring a nightly copy needs a computer with the code (see the last section):

```bash
cd apps/api
npx wrangler kv key get --binding FILES --remote backups/2026-11-14.json > backup.json
node scripts/restore-backup.mjs backup.json > restore.sql
npx wrangler d1 execute mausam --remote --file restore.sql
```

This replaces all data with the backup, so download today's copy first in case you want to undo.

### Good to know

- **Cost.** The free plan covers one restaurant. Its one tight limit is 10 ms of computer time per request, and the app is tuned to fit it. If the logs ever show "exceeded CPU time limit" (error 1102), Cloudflare's $5/month Workers Paid plan removes it. Current limits: https://developers.cloudflare.com/workers/platform/pricing/
- **Login protection.** 5 wrong PINs lock that account for 15 minutes, and one internet connection can try at most 10 logins a minute.
- **Photos** are private and only shown to logged-in users. They're deleted after 400 days so the free 1 GB never fills, which is about a year of bill photos.
- **Demo data** is only for a developer's computer. It never reaches the live database.

---

## If something goes wrong

| What you see | What to do |
| --- | --- |
| Build log near the end mentions `D1`, `Authentication error [code: 10000]` or a permission error | The build's token can't create the database. See [Adding the database permission](#adding-the-database-permission) below. |
| Build log: `The name in your wrangler.jsonc file (mausam-admin) must match the name of your Worker` | The project wasn't named exactly `mausam-admin`. Delete it (**Settings → General → Delete**) and do step 2 again. |
| Build log: `pnpm: command not found`, a lockfile error, or a Node version error | **Settings → Build → Variables and secrets**: add `PNPM_VERSION` = `10.28.0` and `NODE_VERSION` = `22`, then retry the build. |
| Build log: `Could not find a wrangler config file` or `Missing entry-point` | Change **Settings → Build** to: Root directory `apps/api`, Build command `cd ../.. && pnpm install --frozen-lockfile && pnpm build`, Deploy command `pnpm release`. Then retry. |
| Red Cloudflare mark on GitHub pull requests | Preview builds are on. Do step 5. |
| `/api/health` says `"ok":false`, or login says "Something went wrong" | The tables weren't added. **Deployments → ⋯ → Retry build** adds them. |
| The first-run screen says to add a SETUP_CODE first | Do step 6, wait a minute, and reload the page. |
| The first-run screen says the setup code is wrong | It must match `SETUP_CODE` exactly, including capitals. Set it again in step 6. |
| The free memo reader gets numbers wrong | Expected with handwriting. Retake the photo flat and in good light, check each number, or add Claude in step 7. |
| Reminders don't arrive on a phone | Step 11 again on that phone, including the battery setting. |

To see errors as they happen, open **mausam-admin → Observability → Logs**.

### Adding the database permission

Only needed if the first build failed with a D1 or permission error.

1. Click the **person icon** (top right) → **My Profile** → **API Tokens**.
2. Find the token Cloudflare made for the build. Its name mentions `mausam-admin` or "build". Click **⋯ → Edit**.
3. Add the permission **D1** with **Edit** (newer screens call it **Write**) for your account. In the newer layout, open the **Account policy** row, add D1 there, and make sure the policy has your account picked.
4. **Continue to summary** → **Update token**.
5. Back in **mausam-admin → Deployments**, open the failed build and click **Retry build**.

---

## For a developer: publishing from a computer (optional)

This does the same thing as the automatic build. It needs Node.js 22 or newer and Git.

```bash
git clone https://github.com/unbiddenautonomy/mausam && cd mausam
corepack enable                                   # gives you pnpm
pnpm install
cd apps/api && npx wrangler login && cd ../..     # signs in to Cloudflare in the browser
pnpm ship                                         # build, create resources if needed, deploy, add tables
cd apps/api && npx wrangler secret put SETUP_CODE # same as step 6
```

The first time, Wrangler may write the new database and storage IDs into `apps/api/wrangler.jsonc`. You can throw that change away, because it finds them by name either way.
