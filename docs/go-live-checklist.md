# Go-live checklist

Everything in the code is ready. These are the steps only you can do, because they need your accounts. Everything is done in a web browser; plan about 30 minutes the first time. The detailed clicks are in [cloudflare-setup.md](cloudflare-setup.md); this page is the order to do them in and how to check each one.

## Before you start

- [ ] A Cloudflare account (free): https://dash.cloudflare.com/sign-up
- [ ] The GitHub account that holds the Mausam repo.
- [ ] Optional: an Anthropic API key, only if you want the app to read handwritten memo photos.

## 1. Connect Cloudflare to GitHub (setup guide steps 2 and 3)

No card is needed.

- [ ] Make the publishing token (Edit Cloudflare Workers template, plus **D1 · Edit**).
- [ ] Import the repo under **Workers & Pages → Create**, with the project name `mausam-admin`, build command `pnpm install --frozen-lockfile && pnpm build` and deploy command `pnpm release`.
- [ ] Wait for the first build to finish. It creates the database, its tables and the storage for photos and backups. Note the web address.

## 2. Secrets (setup guide steps 4 and 5)

Add these under **mausam-admin → Settings → Variables and Secrets**, type **Secret**. Keep a copy of each in a password manager.

- [ ] **`SETUP_CODE` (recommended), before you open the app.** Until the owner account exists, anyone who finds the web address could create it; with this set, they'd also need the code.
- [ ] Optional: `ANTHROPIC_API_KEY` for memo reading.

Phone reminder keys need no setup; the app makes its own.

## 3. Owner account

- [ ] Open `<address>/api/health`. It should say `"ok":true` and list the number of migrations.
- [ ] Straight away, open the address on your phone and create the owner account (with the setup code).
- [ ] Add managers (**Manage → App users**) and staff (**Manage → Staff**).
- [ ] On each manager's phone: add to home screen, turn on reminders, **Send a test** (setup guide step 6).
- [ ] Billing counter: add the menu and tables, then open `<address>/pos/` on the counter PC (setup guide step 7).

## 4. Updates

Nothing to set up. Every merge to `main` is built and published by Cloudflare within a few minutes, with database changes applied on the way. GitHub checks every pull request first (types, tests, build). If an update breaks something, use **Rollback** under **mausam-admin → Deployments**.

## 5. Safety nets to confirm in the first week

- [ ] **Backups:** the morning after launch, check **Storage & Databases → KV → mausam-admin-files** (the name may differ slightly) has a `backups/` entry for today. One is written every day after 4 am and kept for 35 days. D1 Time Travel also keeps 30 days (7 on the free plan).
- [ ] **Errors:** **mausam-admin → Observability → Logs** shows requests and any errors.
- [ ] **Translations:** have a native Hindi and a native Kannada speaker each spend 15 minutes clicking through the app. The translations are first drafts.
- [ ] **Your custom domain** (optional): setup guide step 9.

## Still open (doesn't block launch)

These questions came up earlier and the app works either way; answering them lets us tune the checks.

1. On the closing memo, does cash + online + expenses always equal the total sales? (The app assumes yes and flags a gap.)
2. Who usually does the morning shopping and who closes the day, so reminders go to the right person?
3. Can your current POS export daily and item sales to Excel or CSV? (The import screen is built for it.)
