import { DEFAULT_SETTINGS, isLocked, type Settings } from "@mausam/shared";
import type { AuthUser } from "../env";
import { HttpError } from "./http";

export async function loadSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of results) {
    if (r.key in DEFAULT_SETTINGS) {
      const def = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[r.key];
      s[r.key] = typeof def === "number" ? Number(r.value) : r.value;
    }
  }
  return s as unknown as Settings;
}

export async function audit(
  db: D1Database,
  table: string,
  rowId: number,
  action: "create" | "update" | "delete",
  before: unknown,
  after: unknown,
  userId: number,
): Promise<void> {
  await db
    .prepare("INSERT INTO audit_log (table_name, row_id, action, before, after, user_id) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(table, rowId, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, userId)
    .run();
}

/** Managers can't change a day after it locks. The owner always can. */
export async function assertDayOpen(db: D1Database, user: AuthUser, date: string): Promise<void> {
  if (user.role === "owner") return;
  const settings = await loadSettings(db);
  if (isLocked(date, new Date(), settings.lock_hour)) throw new HttpError(409, "day_locked");
}

export const bool = (v: unknown) => v === 1 || v === true || v === "1";
