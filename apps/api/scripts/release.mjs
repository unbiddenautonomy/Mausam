// Publishes the API: apply database changes, then deploy. Run by `pnpm release` (Cloudflare's deploy step).
//
// The database changes go first, so new code never runs against an old database. If they fail, nothing is
// published. The one exception is the very first publish: the "mausam" database doesn't exist until the first
// deploy creates it, so when wrangler says it can't find the database, deploy first and then apply the changes.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const MIGRATE = ["d1", "migrations", "apply", "mausam", "--remote"];
const DEPLOY = ["deploy"];

/** Wrangler's words when the database isn't there yet (wrangler 4: "Couldn't find a D1 DB ..."). */
export function isMissingDatabase(output) {
  return /couldn't find a d1 db/i.test(output);
}

/** Runs wrangler with `args`, showing its output as it goes. Resolves to { code, output }. */
function wrangler(args) {
  return new Promise((resolve) => {
    const child = spawn("wrangler", args, { shell: process.platform === "win32", env: { ...process.env, CI: process.env.CI ?? "1" } });
    let output = "";
    child.stdout.on("data", (d) => (process.stdout.write(d), (output += d)));
    child.stderr.on("data", (d) => (process.stderr.write(d), (output += d)));
    child.on("error", (e) => resolve({ code: 1, output: String(e) }));
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

/** The release steps. `run` runs one wrangler command; returns the exit code for the whole release. */
export async function release(run = wrangler, log = console.log) {
  const first = await run(MIGRATE);
  if (first.code === 0) return (await run(DEPLOY)).code;
  if (!isMissingDatabase(first.output)) {
    log("release: the database changes failed, so nothing was published. Fix the migration and publish again.");
    return first.code || 1;
  }
  log("release: no database yet (first publish). Deploying to create it, then applying the database changes.");
  const deploy = await run(DEPLOY);
  if (deploy.code !== 0) return deploy.code;
  return (await run(MIGRATE)).code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await release();
}
