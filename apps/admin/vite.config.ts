import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const require = createRequire(import.meta.url);
const pkgDir = (name: string, from?: string) => realpathSync(dirname(require.resolve(`${name}/package.json`, from ? { paths: [from] } : undefined)));

/**
 * Free memo reading runs Tesseract on the phone. Its worker, engine and language data are served from
 * our own /ocr/ path (the app's security rules don't allow other sites), and only download when someone
 * taps "Read memo". English for the numbers and words, Kannada for Kannada words.
 */
function ocrFiles(): Plugin {
  const tess = pkgDir("tesseract.js");
  const core = pkgDir("tesseract.js-core", tess);
  const files: Record<string, string> = {
    "worker.min.js": join(tess, "dist/worker.min.js"),
    // Only the LSTM engines: the "best_int" language data below has no legacy model.
    "tesseract-core-lstm.wasm.js": join(core, "tesseract-core-lstm.wasm.js"),
    "tesseract-core-simd-lstm.wasm.js": join(core, "tesseract-core-simd-lstm.wasm.js"),
    "tesseract-core-relaxedsimd-lstm.wasm.js": join(core, "tesseract-core-relaxedsimd-lstm.wasm.js"),
    "eng.traineddata.gz": join(pkgDir("@tesseract.js-data/eng"), "4.0.0_best_int/eng.traineddata.gz"),
    "kan.traineddata.gz": join(pkgDir("@tesseract.js-data/kan"), "4.0.0_best_int/kan.traineddata.gz"),
  };
  const type = (f: string) => (f.endsWith(".js") ? "text/javascript" : "application/octet-stream");
  return {
    name: "mausam-ocr-files",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.match(/^\/ocr\/([^?]+)/)?.[1];
        if (!name || !files[name]) return next();
        res.setHeader("Content-Type", type(name));
        res.end(readFileSync(files[name]));
      });
    },
    generateBundle() {
      for (const [name, path] of Object.entries(files)) this.emitFile({ type: "asset", fileName: `ocr/${name}`, source: readFileSync(path) });
    },
  };
}

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

export default defineConfig({
  plugins: [react(), ocrFiles(), versionServiceWorker()],
  server: {
    host: true,
    // In development the API runs on wrangler (port 8787)
    proxy: { "/api": "http://localhost:8787" },
  },
});
