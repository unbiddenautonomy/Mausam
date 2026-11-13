import type { Lang } from "@mausam/shared";

/** Pick the category name in the reader's language, falling back to English. */
export function catName(row: { name_en?: string; name?: string; category_name?: string; name_hi?: string | null; name_kn?: string | null; category_name_hi?: string | null; category_name_kn?: string | null }, lang: Lang): string {
  const en = row.name_en ?? row.name ?? row.category_name ?? "";
  if (lang === "hi") return row.name_hi ?? row.category_name_hi ?? en;
  if (lang === "kn") return row.name_kn ?? row.category_name_kn ?? en;
  return en;
}

/** "2026-11-13 22:51:39" (UTC from the database) -> "4:21 am" in India time. */
export function timeIST(utc: string | null | undefined): string {
  if (!utc) return "";
  const d = new Date(utc.replace(" ", "T") + (utc.endsWith("Z") ? "" : "Z"));
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

/** "01:45" -> "1:45 am" */
export function clock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function newClientId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
