import type { Env } from "../env";
import { raise } from "../cron";
import { deleteFiles, fileExists, listFiles, putFile } from "./files";

/** Tables left out of backups: login tokens (people simply log in again) and the push de-duplication log. */
const SKIP = new Set(["sessions", "notifications_sent", "d1_migrations"]);
const PAGE = 2000;
const BACKUP_HOUR_IST = 4; // after the night's closing, before the morning shopping
/** If there is still no backup by this hour, the owner gets an alert (once a day). */
const MISSING_ALERT_HOUR_IST = 10;

export interface BackupFile {
  version: 1;
  created_at: string;
  migrations: string[];
  tables: Record<string, { columns: string[]; rows: unknown[][] }>;
}

/** The calendar date in India, used to name one backup per day. */
function istDate(now: Date): { date: string; hour: number } {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return { date: ist.toISOString().slice(0, 10), hour: ist.getUTCHours() };
}

/** Reads every table into one JSON document. */
export async function snapshot(db: D1Database, now = new Date()): Promise<BackupFile> {
  const { results: tables } = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")
    .all<{ name: string }>();
  const { results: migrations } = await db.prepare("SELECT name FROM d1_migrations ORDER BY id").all<{ name: string }>().catch(() => ({ results: [] as { name: string }[] }));
  const out: BackupFile = { version: 1, created_at: now.toISOString(), migrations: migrations.map((m) => m.name), tables: {} };
  for (const { name } of tables) {
    if (SKIP.has(name)) continue;
    const quoted = `"${name.replace(/"/g, '""')}"`;
    let columns: string[] = [];
    const rows: unknown[][] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await db.prepare(`SELECT * FROM ${quoted} ORDER BY rowid LIMIT ? OFFSET ?`).bind(PAGE, offset).raw({ columnNames: true });
      const [cols, ...data] = page as unknown as [string[], ...unknown[][]];
      if (cols) columns = cols;
      rows.push(...data);
      if (data.length < PAGE) break;
    }
    if (!columns.length) {
      const { results: info } = await db.prepare(`PRAGMA table_info(${quoted})`).all<{ name: string }>();
      columns = info.map((i) => i.name);
    }
    out.tables[name] = { columns, rows };
  }
  return out;
}

/**
 * Once a day (after 4 am India time) writes a full copy of the database to KV storage as backups/YYYY-MM-DD.json,
 * and deletes copies older than BACKUP_DAYS (default 35). Restore with apps/api/scripts/restore-backup.mjs.
 */
export async function runBackup(env: Env, now = new Date()): Promise<string | null> {
  const { date, hour } = istDate(now);
  if (hour < BACKUP_HOUR_IST) return null;
  const key = `backups/${date}.json`;
  if (await fileExists(env, key)) return null;
  // Still no backup by mid-morning: earlier tries failed. Say so first, while this run still has database calls to spare.
  if (hour >= MISSING_ALERT_HOUR_IST) await raise(env, "backup_missing", date, { date }, "critical", "owner", "/alerts");

  const data = await snapshot(env.DB, now);
  const keep = Math.max(7, Number(env.BACKUP_DAYS) || 35);
  // KV deletes each copy by itself after `keep` days; the cleanup below catches copies made with a longer setting.
  await putFile(env, key, JSON.stringify(data), "application/json", { days: keep });

  const cutoff = new Date(Date.parse(`${date}T00:00:00Z`) - keep * 86_400_000).toISOString().slice(0, 10);
  const old = (await listFiles(env, "backups/")).filter((k) => k.slice(8, 18) < cutoff);
  if (old.length) await deleteFiles(env, old);
  console.log(JSON.stringify({ msg: "backup_written", key, deleted: old.length }));
  return key;
}
