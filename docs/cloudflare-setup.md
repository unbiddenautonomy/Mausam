# Putting Mausam online with Cloudflare

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

## 9. Publishing updates later

```bash
git pull
pnpm install
pnpm --filter @mausam/api db:migrate:remote   # only when a new file was added to apps/api/migrations
pnpm ship
```

## 10. Using your own domain later (optional)

Once you buy a domain (for example `mausam.in`), add it to Cloudflare. Then go to **Workers & Pages → mausam-admin → Settings → Domains & Routes → Add custom domain**, and enter `admin.mausam.in`.

## Things to know

- **Backups:** D1 keeps 30 days of history automatically. You can restore from the dashboard under **D1 → mausam → Time Travel**.
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
| You want to see errors as they happen | `cd apps/api && npx wrangler tail` streams the live logs. |
