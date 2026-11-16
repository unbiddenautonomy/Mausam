# Go-live checklist

The code is ready. These are the steps only you can do, because they need your own accounts. Everything is done in a web browser; plan about 30 minutes. The detailed clicks are in [cloudflare-setup.md](cloudflare-setup.md); this page is the order and the checks.

## Before you start

- [ ] A Cloudflare account (free, no card): https://dash.cloudflare.com/sign-up, email confirmed.
- [ ] Signed in to the GitHub account that owns the `mausam` repo.
- [ ] Optional: an Anthropic API key, only for reading handwritten memo photos.

## 1. Create the Worker (setup guide steps 2 and 3)

- [ ] Publishing token: **Edit Cloudflare Workers** template, plus **Account · D1 · Edit**, zone resources "All zones from an account".
- [ ] **Workers & Pages → Create → Import a repository**, repo `mausam`, project name `mausam-admin`.
- [ ] Build command `pnpm install --frozen-lockfile && pnpm build`, deploy command `pnpm release`, root directory empty.
- [ ] Advanced settings: the token from above, non-production branch builds **off**, build variables `NODE_VERSION=22` and `PNPM_VERSION=10.28.0`.
- [ ] First build shows **Success**. Note the `.workers.dev` address.

## 2. Secrets (setup guide steps 4 and 5)

Under **mausam-admin → Settings → Variables and Secrets**, type **Secret**. Keep a copy of each in a password manager.

- [ ] `SETUP_CODE`, **before anyone opens the app**.
- [ ] Optional: `ANTHROPIC_API_KEY` for memo reading.

## 3. Check it (setup guide step 6)

- [ ] `<address>/api/health` shows `{"ok":true,"migrations":5}`.
- [ ] `<address>/` shows the first-run screen; `<address>/pos/` shows the POS login.
- [ ] D1 lists `mausam`; KV lists `mausam-admin-files`.

## 4. People and devices (setup guide steps 7 and 8)

- [ ] Create the owner account straight away (with the setup code).
- [ ] Add managers (**Manage → App users**) and staff (**Manage → Staff**).
- [ ] Each manager's phone: add to home screen, turn on reminders, **Send a test**.
- [ ] Counter: menu, GST and tables added, a **staff** user for the counter, `/pos/` opened on the counter PC, kiosk-printing shortcut made.
- [ ] Optional: custom domain (setup guide step 9). Do it now rather than after launch, since everyone has to log in again on a new address.

## 5. Updates

Nothing to set up. Every merge to `main` is built and published within a few minutes, with new tables applied on the way. GitHub checks every pull request first (types, tests, build, and a dry-run of the Worker). If an update breaks something: **mausam-admin → Deployments → Rollback**.

## 6. First week

- [ ] **Backups:** the morning after launch, **Storage & Databases → KV → mausam-admin-files** has a `backups/` entry for today.
- [ ] **Errors:** **mausam-admin → Observability → Logs** shows requests and any errors (look for error 1102, CPU limit).
- [ ] **Translations:** a native Hindi and a native Kannada speaker each click through the app for 15 minutes. The translations are first drafts.

## Still open (doesn't block launch)

1. On the closing memo, does cash + online + expenses always equal the total sales? (The app assumes yes and flags a gap.)
2. Who usually does the morning shopping and who closes the day, so reminders go to the right person?
3. Can your current POS export daily and item sales to Excel or CSV? (The import screen is built for it.)
