import { businessDate } from "@mausam/shared";
import type { Env } from "../env";
import { raise } from "../cron";
import { verifyPin } from "./auth";

/** Wrong PINs in a row before an account is locked. */
export const MAX_FAILS = 5;
/** The first lock. Each lock after it, without a right PIN in between, is twice as long, up to a day. */
const FIRST_LOCK_MINUTES = 15;
const LONGEST_LOCK_MINUTES = 24 * 60;

/** What a PIN check needs about a person. */
export interface PinUser { id: number; name: string; pin_hash: string; pin_salt: string; locked_until: string | null; lock_count: number }

/** The columns to select for a PIN check. */
export const PIN_COLUMNS = "id, name, pin_hash, pin_salt, locked_until, lock_count";

/** How long the next lock lasts after `lockCount` locks in a row: 15 minutes, 30, 60, … up to a day. */
export function lockMinutes(lockCount: number): number {
  return Math.min(FIRST_LOCK_MINUTES * 2 ** Math.min(lockCount, 10), LONGEST_LOCK_MINUTES);
}

/**
 * Checks a person's PIN, for logging in, changing a PIN, or allowing a discount on the POS.
 * A wrong PIN is counted in the database itself, so two wrong tries at the same moment both count. The 5th locks the
 * account (longer each time) and alerts the owner. A right PIN clears the count and the lock.
 */
export async function tryPin(env: Env, user: PinUser, pin: string, now = new Date()): Promise<"ok" | "wrong" | "locked"> {
  if (user.locked_until && user.locked_until > now.toISOString()) return "locked";
  const db = env.DB;
  if (await verifyPin(pin, user.pin_hash, user.pin_salt)) {
    await db.prepare(
      `UPDATE users SET failed_logins = 0, locked_until = NULL, lock_count = 0
       WHERE id = ? AND (failed_logins <> 0 OR locked_until IS NOT NULL OR lock_count <> 0)`,
    ).bind(user.id).run();
    return "ok";
  }
  const row = await db.prepare("UPDATE users SET failed_logins = failed_logins + 1 WHERE id = ? RETURNING failed_logins, lock_count")
    .bind(user.id)
    .first<{ failed_logins: number; lock_count: number }>();
  if (row && row.failed_logins >= MAX_FAILS) {
    const minutes = lockMinutes(row.lock_count);
    const until = new Date(now.getTime() + minutes * 60_000).toISOString();
    // Only one of two tries at the same moment locks the account (and sends the alert).
    const res = await db.prepare(
      "UPDATE users SET failed_logins = 0, locked_until = ?, lock_count = lock_count + 1 WHERE id = ? AND failed_logins >= ?",
    ).bind(until, user.id, MAX_FAILS).run();
    if (res.meta.changes) {
      await raise(env, `login_locked:${user.id}`, businessDate(now), { name: user.name, count: minutes }, "warn", "owner", "/manage/users");
    }
  }
  return "wrong";
}
