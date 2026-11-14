import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The POS is served at /pos/ by the same Worker as the admin app. Its build goes inside the admin
// app's output folder (built first), so one `wrangler deploy` publishes both.
export default defineConfig({
  base: "/pos/",
  plugins: [react()],
  build: { outDir: "../admin/dist/pos", emptyOutDir: true },
  server: {
    host: true,
    proxy: { "/api": "http://localhost:8787" },
  },
});
