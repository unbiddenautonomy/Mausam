import type { Lang } from "./types";
// The restaurant closes around 1–1:30 am, so a "business day" runs from 5 am to 5 am India time.
// Everything is stored against a business date string: "YYYY-MM-DD".

export const IST_OFFSET_MINUTES = 330;
export const DAY_START_HOUR = 5;

function istParts(at: Date) {
  const shifted = new Date(at.getTime() + IST_OFFSET_MINUTES * 60_000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    min: shifted.getUTCMinutes(),
  };
}

export function toISODate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function addDays(date: string, days: number): string {
  const t = Date.parse(date + "T00:00:00Z") + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Business date for a moment in time. 1:30 am on 13 Nov belongs to 12 Nov. */
export function businessDate(at: Date = new Date(), dayStartHour = DAY_START_HOUR): string {
  const p = istParts(at);
  const today = toISODate(p.y, p.m, p.d);
  return p.h < dayStartHour ? addDays(today, -1) : today;
}

/** IST hour and minute now, as minutes since midnight IST. */
export function istMinutesOfDay(at: Date = new Date()): number {
  const p = istParts(at);
  return p.h * 60 + p.min;
}

/** The moment (UTC) that a given IST wall-clock time on a calendar date happens. */
export function istMoment(date: string, hour: number, minute = 0): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) + (hour * 60 + minute - IST_OFFSET_MINUTES) * 60_000);
}

/** A business day locks at `lockHour` IST on the next calendar day (default 11 am). */
export function isLocked(date: string, now: Date = new Date(), lockHour = 11): boolean {
  return now.getTime() >= istMoment(addDays(date, 1), lockHour).getTime();
}

export function dayOfWeek(date: string): number {
  return new Date(date + "T00:00:00Z").getUTCDay();
}

/** Inclusive list of dates between from and to. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const LOCALES: Record<Lang, string> = { en: "en-IN", hi: "hi-IN", kn: "kn-IN" };
let dateLang: Lang = "en";

/** The language dates and times are written in when a caller does not name one. The admin app sets it with the screen language. */
export function setDateLang(lang: Lang): void {
  dateLang = lang;
}

/** The Intl locale for a language, e.g. "hi-IN". */
export function dateLocale(lang: Lang = dateLang): string {
  return LOCALES[lang] ?? "en-IN";
}

function intl(date: string, lang: Lang, opts: Intl.DateTimeFormatOptions): string | null {
  try {
    return new Intl.DateTimeFormat(LOCALES[lang], { ...opts, timeZone: "UTC" }).format(new Date(date + "T00:00:00Z"));
  } catch {
    return null; // no locale data: fall back to English
  }
}

/** "2026-11-12" -> "Thu, 12 Nov" (or the same in Hindi or Kannada) */
export function formatDay(date: string, withWeekday = true, lang: Lang = dateLang): string {
  if (lang !== "en") {
    const out = intl(date, lang, withWeekday ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short" });
    if (out) return out;
  }
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  const label = `${d} ${MONTHS[m - 1]}`;
  return withWeekday ? `${DAYS[dayOfWeek(date)]}, ${label}` : label;
}

/** "2026-11-12" -> "Thu" */
export function weekdayShort(date: string, lang: Lang = dateLang): string {
  return (lang !== "en" && intl(date, lang, { weekday: "short" })) || DAYS[dayOfWeek(date)];
}

/** Weekday names Sunday first, e.g. for a week grid. */
export function weekdayNames(lang: Lang = dateLang): string[] {
  // 2026-11-01 is a Sunday.
  return [0, 1, 2, 3, 4, 5, 6].map((i) => weekdayShort(addDays("2026-11-01", i), lang));
}

/** A moment shown as India time of day, e.g. "4:21 pm". */
export function formatTime(at: Date | string, lang: Lang = dateLang): string {
  const d = typeof at === "string" ? new Date(at.includes("T") || at.endsWith("Z") ? at : at.replace(" ", "T") + "Z") : at;
  return d.toLocaleTimeString(dateLocale(lang), { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

/** An hour of the day (0 to 23) as a short label, e.g. "9 pm". */
export function formatHour(hour: number, lang: Lang = dateLang): string {
  return new Date(Date.UTC(2000, 0, 1, hour)).toLocaleTimeString(dateLocale(lang), { hour: "numeric", timeZone: "UTC" });
}

/** "01:45" -> "1:45 am" */
export function formatClock(hhmm: string, lang: Lang = dateLang): string {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2000, 0, 1, h || 0, m || 0)).toLocaleTimeString(dateLocale(lang), { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

/** Month-close window: 27th to 3rd. Returns the month (YYYY-MM) being closed, or null outside the window. */
export function monthCloseFor(date: string): string | null {
  const day = Number(date.slice(8, 10));
  if (day >= 27) return date.slice(0, 7);
  if (day <= 3) return addDays(date.slice(0, 8) + "01", -1).slice(0, 7);
  return null;
}
