import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Names the service worker's cache after this build, so each new build starts a fresh cache and the old one, with
 * last build's files, is deleted when the new worker takes over.
 */
function versionServiceWorker(): Plugin {
  let outDir = "dist";
  return {
    name: "mausam-sw-version",
    apply: "build",
    configResolved(c) {
      outDir = c.build.outDir.startsWith("/") ? c.build.outDir : join(c.root, c.build.outDir);
    },
    writeBundle(_options, bundle) {
      const file = join(outDir, "sw.js");
      const version = createHash("sha1").update(Object.keys(bundle).sort().join("\n")).digest("hex").slice(0, 10);
      const src = readFileSync(file, "utf8");
      const out = src.replace(/(const CACHE = "mausam-[a-z]+-)v1"/, `$1${version}"`);
      if (out === src) throw new Error("sw.js: cache name not found");
      writeFileSync(file, out);
    },
  };
}

// The POS is served at /pos/ by the same Worker as the admin app. Its build goes inside the admin
// app's output folder (built first), so one `wrangler deploy` publishes both.
export default defineConfig({
  base: "/pos/",
  plugins: [react(), versionServiceWorker()],
  build: { outDir: "../admin/dist/pos", emptyOutDir: true },
  server: {
    host: true,
    proxy: { "/api": "http://localhost:8787" },
  },
});
