// All money is stored as whole paise (1 rupee = 100 paise) to avoid rounding errors.

export type Paise = number;

/** "127680" or "1,27,680.50" -> paise. Returns null when the text is not a valid amount. */
export function rupeesToPaise(input: string | number | null | undefined): Paise | null {
  if (input === null || input === undefined) return null;
  const text = String(input).replace(/[₹,\s]/g, "");
  if (text === "") return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ""] = text.replace("-", "").split(".");
  const paise = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return text.startsWith("-") ? -paise : paise;
}

/** Indian grouping: 12345678 -> "1,23,45,678" */
function groupIndian(whole: string): string {
  if (whole.length <= 3) return whole;
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

/** paise -> "₹1,27,680" (decimals only when not whole rupees). */
export function formatINR(paise: Paise | null | undefined, opts: { symbol?: boolean } = {}): string {
  if (paise === null || paise === undefined || Number.isNaN(paise)) return "—";
  const symbol = opts.symbol === false ? "" : "₹";
  const negative = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const whole = Math.floor(abs / 100).toString();
  const frac = abs % 100;
  const body = groupIndian(whole) + (frac ? "." + String(frac).padStart(2, "0") : "");
  return `${negative ? "−" : ""}${symbol}${body}`;
}

/** Short form for chart axes: ₹1.2L, ₹45k */
export function formatINRShort(paise: Paise): string {
  const rupees = paise / 100;
  const abs = Math.abs(rupees);
  const sign = rupees < 0 ? "−" : "";
  if (abs >= 1_00_00_000) return `${sign}₹${trim(abs / 1_00_00_000)}Cr`;
  if (abs >= 1_00_000) return `${sign}₹${trim(abs / 1_00_000)}L`;
  if (abs >= 1_000) return `${sign}₹${trim(abs / 1_000)}k`;
  return `${sign}₹${Math.round(abs)}`;
}

function trim(n: number): string {
  return n >= 10 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, "");
}
