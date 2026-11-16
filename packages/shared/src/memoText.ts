// Turns the text that free OCR (Tesseract, run on the phone) saw on a closing memo into numbers.
// OCR on handwriting is rough, so this only suggests numbers: the manager's typed numbers stay the record.
// Rule of thumb it follows: a line's amount is the last number on it, and a keyword on the line says what the amount is.

export interface OcrLine {
  text: string;
  /** 0 to 100, as Tesseract reports it. */
  confidence: number;
}

export type MemoField = "date" | "total" | "cash" | "online" | "expenses_total" | "lines";

/** Same shape the server stores for a Claude read. Amounts are paise. */
export interface MemoReadResult {
  date: string | null;
  total: number | null;
  cash: number | null;
  online: number | null;
  expenses_total: number | null;
  lines: { label: string; amount: number }[];
  unsure: MemoField[];
  note: string | null;
}

/** Below this, Tesseract is guessing. */
const LOW_CONFIDENCE = 70;

// Words people write on the memo, in English, Hindi and Kannada (and common short forms).
const KEYWORDS: Record<"total" | "cash" | "online" | "expenses_total" | "online_part", RegExp> = {
  total: /\b(total|ttl|tot|grand|sale|sales|counter)\b|ಒಟ್ಟು|ಮಾರಾಟ|कुल|टोटल|बिक्री/i,
  cash: /\b(cash|csh|kash)\b|ನಗದು|ಕ್ಯಾಶ್|नकद|कैश/i,
  online: /\b(online|onln)\b|ಆನ್‌?ಲೈನ್|ऑनलाइन/i,
  online_part: /\b(upi|g\s?pay|gpay|google\s?pay|phone\s?pe|phonepe|paytm|card|swipe|bharat\s?pe|qr)\b|ಕಾರ್ಡ್|कार्ड/i,
  expenses_total: /\b(exp|expense|expenses|exps|kharcha|kharch)\b|ಖರ್ಚು|खर्च/i,
};

// Kannada (೦-೯) and Devanagari (०-९) digits become 0-9.
function asciiDigits(s: string): string {
  return s.replace(/[೦-೯]/g, (d) => String(d.charCodeAt(0) - 0x0ce6)).replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966));
}

// Letters OCR often reads in place of digits, fixed only inside tokens that are mostly digits.
const LOOKALIKE: Record<string, string> = { O: "0", o: "0", D: "0", Q: "0", l: "1", I: "1", i: "1", "|": "1", "!": "1", z: "2", Z: "2", S: "5", s: "5", B: "8", g: "9", q: "9", b: "6", G: "6" };

interface Amount {
  paise: number;
  /** A letter was swapped for a digit to read it. */
  fixed: boolean;
  /** Where the number starts in the line, so the label is what comes before it. */
  index: number;
}

/** The last amount on a line, in paise, or null. Accepts 1,250 / 1250/- / Rs.1250 / ₹1250.50. */
export function lastAmount(line: string): Amount | null {
  // "Rs." and "₹" in front of a number become a space, so "Rs1200" reads as 1200. Same length keeps positions right.
  const s = asciiDigits(line).replace(/\b(rs|inr)\.?|₹/gi, (m) => " ".repeat(m.length));
  // Candidate tokens: digits, separators and look-alike letters, not glued to a word in front ("A2627").
  const re = /(?<![A-Za-z0-9])[0-9OoDQlIi|!zZSsBgqbG][0-9OoDQlIi|!zZSsBgqbG,.]*(?:\/-)?/g;
  let best: Amount | null = null;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    let tok = m[0].replace(/\/-$/, "");
    const digits = (tok.match(/[0-9]/g) ?? []).length;
    const letters = tok.replace(/[0-9,.]/g, "").length;
    // Needs a real digit, and either more digits than look-alikes or a digit first ("3oo"), so words like "Oil" stay words.
    if (digits === 0 || (letters >= digits && !/^[0-9]/.test(tok))) continue;
    // A token glued to letters after it is part of a word ("2nd").
    if (/[A-Za-z]/.test(s[m.index + m[0].length] ?? " ")) continue;
    const fixed = letters > 0;
    tok = tok.replace(/[^0-9,.]/g, (c) => LOOKALIKE[c] ?? "");
    tok = tok.replace(/[.,]+$/, "");
    // "1,250" and "1.250" with three digits after are thousands; "1250.50" is rupees and paise.
    let rupees: number;
    const dec = tok.match(/^([0-9,.]*?)[.]([0-9]{1,2})$/);
    if (dec) rupees = Number(dec[1].replace(/[.,]/g, "") || "0") + Number(dec[2].padEnd(2, "0")) / 100;
    else rupees = Number(tok.replace(/[.,]/g, ""));
    if (!Number.isFinite(rupees) || rupees <= 0 || rupees >= 10_000_000) continue;
    best = { paise: Math.round(rupees * 100), fixed, index: m.index };
  }
  return best;
}

/** A date written as 14/11/2026, 14-11-26, 14.11.2026. Day first, as written in India. */
export function findDate(line: string): string | null {
  const m = asciiDigits(line).match(/\b(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2}|\d{4})\b/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 2020 || y > 2099) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function cleanLabel(s: string): string {
  return s
    .replace(/(rs\.?|₹|=|:|-|—|\.{2,}|\|)+\s*$/i, "")
    .replace(/^[\s\-–—•*.,:;|#)(]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Reads the memo's numbers from OCR lines. Never calculates a number that isn't written. */
export function parseMemoText(lines: OcrLine[]): MemoReadResult {
  const out: MemoReadResult = { date: null, total: null, cash: null, online: null, expenses_total: null, lines: [], unsure: [], note: null };
  const unsure = new Set<MemoField>();
  const onlineParts: { paise: number; shaky: boolean }[] = [];

  for (const { text, confidence } of lines) {
    const line = text.trim();
    if (!line) continue;
    if (!out.date) {
      const d = findDate(line);
      if (d) {
        out.date = d;
        if (confidence < LOW_CONFIDENCE) unsure.add("date");
        continue;
      }
    }
    if (findDate(line)) continue;
    const amt = lastAmount(line);
    if (!amt) continue;
    const shaky = amt.fixed || confidence < LOW_CONFIDENCE;
    const label = line.slice(0, amt.index);

    const field = KEYWORDS.expenses_total.test(label) && /\b(total|ttl|tot)\b|ಒಟ್ಟು|कुल/i.test(label)
      ? "expenses_total"
      : KEYWORDS.online.test(label)
        ? "online"
        : KEYWORDS.cash.test(label)
          ? "cash"
          : KEYWORDS.expenses_total.test(label)
            ? "expenses_total"
            : KEYWORDS.total.test(label)
              ? "total"
              : KEYWORDS.online_part.test(label)
                ? "online_part"
                : null;

    if (field === "online_part") {
      onlineParts.push({ paise: amt.paise, shaky });
    } else if (field) {
      // The first time a word shows up wins; a second one is a sign of a misread.
      if (out[field] === null) {
        out[field] = amt.paise;
        if (shaky) unsure.add(field);
      } else unsure.add(field);
    } else {
      const name = cleanLabel(label);
      // A line item needs a name with at least two letters (any script).
      if ((name.match(/\p{L}/gu) ?? []).length >= 2) {
        out.lines.push({ label: name, amount: amt.paise });
        if (shaky) unsure.add("lines");
      }
    }
  }

  // UPI, card and the like written separately, with no "online" line: add them up (they were all written).
  if (out.online === null && onlineParts.length) {
    out.online = onlineParts.reduce((s, p) => s + p.paise, 0);
    if (onlineParts.length > 1 || onlineParts.some((p) => p.shaky)) unsure.add("online");
  }

  // Their rule is cash + online + expenses = total. If all four were read and it doesn't hold, one is misread.
  const { total, cash, online, expenses_total } = out;
  if (total !== null && cash !== null && online !== null && expenses_total !== null && cash + online + expenses_total !== total) {
    for (const f of ["total", "cash", "online", "expenses_total"] as const) unsure.add(f);
  }

  out.unsure = (["date", "total", "cash", "online", "expenses_total", "lines"] as const).filter((f) => unsure.has(f));
  return out;
}
