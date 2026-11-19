// Lint rules for the whole repo: `pnpm lint`. Type-aware rules are left out to keep it quick.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", ".wrangler*/**", "**/.wrangler/**", "apps/*/public/**", "**/worker-configuration.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // The app talks to JSON from the server and D1; `any` is used on purpose in a few wrappers.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true }],
      // `cond && fn()` and `(a(), b())` are used for short handlers.
      "@typescript-eslint/no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true }],
    },
  },
  {
    files: ["apps/admin/src/**/*.{ts,tsx}", "apps/pos/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly", Buffer: "readonly", TextEncoder: "readonly", crypto: "readonly", fetch: "readonly" } },
  },
);
