# Go-live checklist

Everything in the code is ready. These are the steps only you can do, because they need your accounts. Plan about 45 minutes, on a computer, the first time. The detailed commands are in [cloudflare-setup.md](cloudflare-setup.md); this page is the order to do them in and how to check each one.

## Before you start

- [ ] A Cloudflare account (free): https://dash.cloudflare.com/sign-up
- [ ] Node.js 22+ and pnpm on your computer, and `pnpm install` run in this repo.
- [ ] Decide the email to use for push notifications (`VAPID_SUBJECT`). Any address you read is fine.
- [ ] Optional: an Anthropic API key, only if you want the app to read handwritten memo photos.

## 1. Cloudflare resources (setup guide steps 2 to 4)

- [ ] `npx wrangler login` and click **Allow**.
- [ ] `npx wrangler d1 create mausam`, then paste the `database_id` into `apps/api/wrangler.jsonc`.
- [ ] `npx wrangler d1 migrations apply mausam --remote`.
- [ ] Turn on R2 in the dashboard, then `npx wrangler r2 bucket create mausam-photos`.

## 2. Keys and secrets (setup guide steps 5 and 6)

Secrets are typed into the terminal once and never saved in a file. Keep a copy of each in a password manager.

- [ ] `node apps/api/scripts/vapid-keys.mjs`. Public key and email go in `wrangler.jsonc`; then `npx wrangler secret put VAPID_PRIVATE_KEY`.
- [ ] **Setup code (recommended):** pick a phrase only you know, then `npx wrangler secret put SETUP_CODE`. Until the owner account exists, anyone who finds the web address could create it; with this set, they'd also need the code.
- [ ] Optional: `npx wrangler secret put ANTHROPIC_API_KEY`.

## 3. First publish and owner account

- [ ] `pnpm ship` from the repo root. Note the web address it prints.
- [ ] Open `<address>/api/health`. It should say `{"ok":true,"migrations":5}`.
- [ ] Straight away, open the address on your phone and create the owner account (with the setup code).
- [ ] Add managers (**Manage → App users**) and staff (**Manage → Staff**).
- [ ] On each manager's phone: add to home screen, turn on reminders, **Send a test** (setup guide step 8).

## 4. Automatic publishing from GitHub (optional, recommended)

After this, merging a pull request is all it takes to publish an update. Database changes are applied first.

- [ ] Create an API token: Cloudflare dashboard → **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"** template. Add **Account → D1 → Edit** to its permissions. Limit it to your account.
- [ ] Find your **Account ID** on the Workers & Pages overview page (right-hand side).
- [ ] In GitHub: **Settings → Secrets and variables → Actions**:
  - Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
  - Variables: `APP_URL` = your web address (so each deploy checks the app answers), and `AUTO_DEPLOY` = `true` if you want every merge to publish.
- [ ] Commit the real `database_id` in `wrangler.jsonc` (it's not a secret). The deploy refuses to run with the placeholder.
- [ ] Test it: **Actions → Deploy → Run workflow**.

## 5. Safety nets to confirm in the first week

- [ ] **Backups:** the morning after launch, check R2 → `mausam-photos` → `backups/` has a file for today. One is written every day after 4 am and kept for 35 days. D1 Time Travel also keeps 30 days (7 on the free plan).
- [ ] **Errors:** Workers & Pages → `mausam-admin` → **Logs** shows requests and any errors.
- [ ] **Translations:** have a native Hindi and a native Kannada speaker each spend 15 minutes clicking through the app. The translations are first drafts.
- [ ] **Your custom domain** (optional): setup guide step 10.

## Still open (doesn't block launch)

These questions came up earlier and the app works either way; answering them lets us tune the checks.

1. On the closing memo, does cash + online + expenses always equal the total sales? (The app assumes yes and flags a gap.)
2. Who usually does the morning shopping and who closes the day, so reminders go to the right person?
3. Can your current POS export daily and item sales to Excel or CSV? (The import screen is built for it.)
