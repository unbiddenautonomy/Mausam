import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // In development the API runs on wrangler (port 8787)
    proxy: { "/api": "http://localhost:8787" },
  },
});
