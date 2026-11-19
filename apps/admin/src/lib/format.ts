import { formatClock, formatTime, type Lang } from "@mausam/shared";

/** Pick the category name in the reader's language, falling back to English. */
export function catName(row: { name_en?: string; name?: string; category_name?: string; name_hi?: string | null; name_kn?: string | null; category_name_hi?: string | null; category_name_kn?: string | null }, lang: Lang): string {
  const en = row.name_en ?? row.name ?? row.category_name ?? "";
  if (lang === "hi") return row.name_hi ?? row.category_name_hi ?? en;
  if (lang === "kn") return row.name_kn ?? row.category_name_kn ?? en;
  return en;
}

/** "2026-11-13 22:51:39" (UTC from the database) -> "4:21 am" in India time, in the screen language. */
export function timeIST(utc: string | null | undefined): string {
  return utc ? formatTime(utc) : "";
}

/** "2026-11-13 22:51:39" (UTC) -> its date in India time, "2026-11-14". */
export function dateIST(utc: string): string {
  const d = new Date(utc.replace(" ", "T") + (utc.endsWith("Z") || utc.includes("+") ? "" : "Z"));
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** "01:45" -> "1:45 am" */
export const clock = (hhmm: string) => formatClock(hhmm);

export function newClientId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
