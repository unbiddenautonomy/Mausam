import { describe, expect, it } from "vitest";
import { isMissingDatabase, release } from "./release.mjs";

function fake(answers) {
  const calls = [];
  const run = async (args) => {
    calls.push(args[0] === "deploy" ? "deploy" : "migrate");
    return answers.shift() ?? { code: 0, output: "" };
  };
  return { run, calls };
}
const quiet = () => {};

describe("release", () => {
  it("applies database changes, then deploys", async () => {
    const f = fake([{ code: 0, output: "Migrations applied" }, { code: 0, output: "Deployed" }]);
    expect(await release(f.run, quiet)).toBe(0);
    expect(f.calls).toEqual(["migrate", "deploy"]);
  });
  it("stops before deploying when a migration fails", async () => {
    const f = fake([{ code: 1, output: "✘ [ERROR] near \"TABLEE\": syntax error" }]);
    expect(await release(f.run, quiet)).toBe(1);
    expect(f.calls).toEqual(["migrate"]);
  });
  it("on the first publish, deploys to create the database and then migrates", async () => {
    const f = fake([{ code: 1, output: "✘ [ERROR] Couldn't find a D1 DB with the name or binding 'mausam' in your wrangler.jsonc file." }, { code: 0, output: "" }, { code: 0, output: "" }]);
    expect(await release(f.run, quiet)).toBe(0);
    expect(f.calls).toEqual(["migrate", "deploy", "migrate"]);
  });
  it("recognises wrangler's missing-database messages", () => {
    expect(isMissingDatabase("Couldn't find a D1 DB named 'mausam' (bound as 'DB') in the API.")).toBe(true);
    expect(isMissingDatabase("Authentication error [code: 10000]")).toBe(false);
  });
});
