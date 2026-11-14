# Putting Mausam online with Cloudflare

Everything here is done in a web browser. You don't need to install anything, and no single computer is "the" Mausam computer. The code lives on GitHub. Cloudflare watches the GitHub repo and publishes the app by itself every time new code is pushed.

A laptop or desktop screen is easier for the Cloudflare dashboard, but a phone works too.

It takes about 20 minutes the first time. At the end you'll have one web address, such as `https://mausam-admin.<your-name>.workers.dev`, that serves both the app and its API. It's free to start. Cloudflare's $5/month plan is only needed once usage grows.

## 1. What you need

- A Cloudflare account. Sign up free at https://dash.cloudflare.com/sign-up.
- The GitHub account that holds the Mausam repo.

## 2. Turn on photo storage

Bill and memo photos are kept in Cloudflare R2, which has to be switched on once.

1. In the Cloudflare dashboard, open **R2 Object Storage**.
2. Click **Purchase / Enable**. It's free up to 10 GB, but it may ask for a card.

You don't need to create anything inside it. The first publish makes the `mausam-photos` storage for you.

## 3. Make a publishing key

Cloudflare needs permission to create the database and update it when the app changes.

1. Open **Manage Account → Account API Tokens**, then click **Create Token**.
2. Next to **Edit Cloudflare Workers**, click **Use template**.
3. Under **Permissions**, click **Add more**. Choose **Account**, then **D1**, then **Edit**.
4. Click **Continue to summary**, then **Create Token**.

You don't need to copy the token anywhere. You'll pick it from a list in the next step.

## 4. Connect the GitHub repo

1. Open **Workers & Pages**, then **Create**, then **Import a repository**.
2. Connect GitHub when it asks. Allow access to the **Mausam** repo.
3. Pick the Mausam repo and fill in these fields exactly:

| Field | Value |
| --- | --- |
| Project name | `mausam-admin` |
| Build command | `pnpm install --frozen-lockfile && pnpm build` |
| Deploy command | `pnpm release` |
| Root directory | leave empty, or `/` |
| API token | the token you made in step 3 |

4. Click **Create and deploy**. Look for **API token** under **Advanced settings** if it isn't on the main form.

The first build takes 2 to 3 minutes. It creates the `mausam` database and its tables, and the photo storage. When it's done, the page shows your web address.

**If the first build fails** with a permissions or D1 error, the token wasn't picked. Open **mausam-admin → Settings → Build → API token**, choose the token from step 3, then retry the build from the **Deployments** tab.

## 5. Turn on memo reading (optional)

The app can read the handwritten closing memo photo and fill in the numbers. It uses Claude, Anthropic's AI, which charges per use (roughly ₹2 to ₹5 per memo). Each day's memo can be read at most 6 times, so costs stay small.

1. Make an account at console.anthropic.com, add a little credit, and create an API key.
2. In Cloudflare, open **mausam-admin → Settings → Variables and Secrets**, then click **Add**.
3. Set **Type** to **Secret**, **Variable name** to `ANTHROPIC_API_KEY`, and paste the key as the value. Click **Deploy**.

Without this key, everything else works and the "Read memo" button just says it isn't set up.

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

## 7. Updates

There's nothing to do. When new code is pushed to the `main` branch on GitHub, Cloudflare builds and publishes it within a few minutes, and applies any database changes on the way. You can watch it under **mausam-admin → Deployments**.

If an update ever breaks something, open **Deployments**, find the previous version, and choose **Rollback**.

## 8. Using your own domain later (optional)

Once you buy a domain (for example `mausam.in`), add it to Cloudflare. Then go to **Workers & Pages → mausam-admin → Settings → Domains & Routes → Add custom domain**, and enter `admin.mausam.in`.

## Things to know

- **Backups:** D1 keeps 30 days of history automatically. You can restore from the dashboard under **D1 → mausam → Time Travel**.
- **Photos** are private and only shown to logged-in users.
- **Reminders:** the app checks for overdue reports every 15 minutes, using the `triggers.crons` setting in `apps/api/wrangler.jsonc`.
- **Costs:** Workers, D1 and R2 all have free allowances that should cover a single restaurant at first. Check https://developers.cloudflare.com/workers/platform/pricing/ for current limits.
- **Demo data** is only for trying the app on a developer's computer. It is never sent to the live database.

## If something goes wrong

| Problem | Fix |
| --- | --- |
| Build says the name in the Wrangler file must match the Worker | The project must be called exactly `mausam-admin`. |
| Build fails with a D1 or permissions error | Step 3 and the last part of step 4: make the token with **D1 · Edit** and pick it under **Settings → Build → API token**. |
| Build fails with an R2 error | Step 2: turn on R2 once, then retry the build. |
| The app opens, but login says "Something went wrong" | The tables are missing. Retry the latest build under **Deployments**. It creates them. |
| You want to see errors as they happen | **mausam-admin → Observability → Logs** shows the live logs. |

## Publishing from a computer instead (optional)

A developer can also publish from their own computer. This is the same thing the automatic build does. From the repo root, after `pnpm install`:

```bash
cd apps/api && npx wrangler login && cd ../..
pnpm ship
```
