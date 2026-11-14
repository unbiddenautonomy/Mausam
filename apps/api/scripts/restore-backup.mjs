#!/usr/bin/env node
// Turns a nightly backup (backups/YYYY-MM-DD.json from the FILES storage) into SQL that replaces the data in a database
// that already has all migrations applied. See docs/cloudflare-setup.md → "Restoring a backup".
//
//   node scripts/restore-backup.mjs backup.json > restore.sql
//   npx wrangler d1 execute mausam --remote --file restore.sql
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/restore-backup.mjs <backup.json>");
  process.exit(1);
}
const backup = JSON.parse(readFileSync(file, "utf8"));
if (backup.version !== 1 || typeof backup.tables !== "object") {
  console.error("This doesn't look like a Mausam backup file.");
  process.exit(1);
}

const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;
const value = (v) => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${String(v).replace(/'/g, "''")}'`;
};

const out = [];
out.push(`-- Mausam restore from backup taken ${backup.created_at}`);
out.push(`-- Migrations at backup time: ${(backup.migrations ?? []).join(", ")}`);
out.push("PRAGMA defer_foreign_keys = true;");
const names = Object.keys(backup.tables);
for (const name of names) out.push(`DELETE FROM ${ident(name)};`);
out.push("DELETE FROM sessions;");
for (const name of names) {
  const { columns, rows } = backup.tables[name];
  if (!rows.length) continue;
  const cols = columns.map(ident).join(", ");
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50).map((r) => `(${r.map(value).join(", ")})`).join(",\n  ");
    out.push(`INSERT INTO ${ident(name)} (${cols}) VALUES\n  ${chunk};`);
  }
}
process.stdout.write(out.join("\n") + "\n");
console.error(`Wrote SQL for ${names.length} tables, ${names.reduce((n, t) => n + backup.tables[t].rows.length, 0)} rows.`);
