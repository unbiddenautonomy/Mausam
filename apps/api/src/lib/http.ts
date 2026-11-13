import { rupeesToPaise } from "@mausam/shared";

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429,
    public code: string,
    public detail?: unknown,
  ) {
    super(code);
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDate(v: unknown): v is string {
  return typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));
}

export function requireDate(v: unknown, field = "date"): string {
  if (!isDate(v)) throw new HttpError(422, "invalid", { field });
  return v;
}

/** Accept integer paise from the app. Also accepts rupee strings for convenience. */
export function requirePaise(v: unknown, field: string, opts: { allowZero?: boolean } = {}): number {
  let n: number | null = null;
  if (typeof v === "number" && Number.isInteger(v)) n = v;
  else if (typeof v === "string") n = rupeesToPaise(v);
  if (n === null || n < 0 || (!opts.allowZero && n === 0) || n > 1_00_00_000_00) {
    throw new HttpError(422, "invalid", { field });
  }
  return n;
}

export function optionalPaise(v: unknown, field: string): number | null {
  if (v === null || v === undefined || v === "") return null;
  return requirePaise(v, field, { allowZero: true });
}

export function optionalText(v: unknown, max = 500): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new HttpError(422, "invalid");
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

export function requireText(v: unknown, field: string, max = 200): string {
  const t = optionalText(v, max);
  if (!t) throw new HttpError(422, "invalid", { field });
  return t;
}
