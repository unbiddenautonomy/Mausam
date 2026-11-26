// Turns a pasted staff list ("Raju bhai 28000 Rohit 23000 ...") and a waiter list into rows the owner can check
// before saving, matched to people already on Staff where the name (or a common spelling of it) is the same.

export interface Existing {
  id: number;
  name: string;
  active: boolean;
  is_waiter?: number;
}

export interface ImportRow {
  name: string;
  role: string;
  /** Monthly salary in rupees, or null for someone on the waiter list only. */
  salary: number | null;
  waiter: boolean;
  /** The person on Staff this is, or null to add someone new. */
  match: number | null;
}

/** Words after a name that say what someone does, not who they are. */
const ROLE_WORDS: Record<string, string> = {
  waiter: "Waiter", waitor: "Waiter", waiters: "Waiter",
  dosa: "Dosa", chinese: "Chinese", tandoor: "Tandoor", tandoori: "Tandoor", chaat: "Chaat", juice: "Juice",
  cook: "Cook", chef: "Cook", helper: "Helper", cleaner: "Cleaner", cashier: "Cashier", dishwasher: "Dishwasher",
};

const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/** Splits a typed name into the name itself and a role word after it ("Mukesh dosa" -> Mukesh, Dosa). */
export function splitRole(raw: string): { name: string; role: string } {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  const roles: string[] = [];
  while (words.length > 1 && ROLE_WORDS[words[words.length - 1].toLowerCase()]) roles.unshift(ROLE_WORDS[words.pop()!.toLowerCase()]);
  return { name: titleCase(words.join(" ")), role: roles.join(", ") };
}

/** "Raju bhai 28000 Rohit 23,000\nmithul - ₹15000" -> names with salaries, in the order typed. */
export function parseSalaries(text: string): { name: string; role: string; salary: number }[] {
  const out: { name: string; role: string; salary: number }[] = [];
  const re = /([^\d\n,;:₹=-][^\d\n;:₹=]*?)\s*[-:=–]?\s*(?:₹|rs\.?\s*)?(\d[\d,]*)(?:\s*\/-)?/gi;
  for (const m of text.matchAll(re)) {
    const name = m[1].replace(/^[\s,.;|•*-]+|[\s,.;|•*-]+$/g, "").replace(/\s*\b(rs|inr)\.?$/i, "");
    const salary = Number(m[2].replace(/,/g, ""));
    if (!name || !/[a-z]/i.test(name) || !salary) continue;
    out.push({ ...splitRole(name), salary });
  }
  return out;
}

/** One waiter per line; a heading like "Waiter List:" and numbering are left out. */
export function parseNames(text: string): string[] {
  return text
    .split(/\n|,/)
    .map((l) => l.replace(/^\s*(\d+[.)]|[-•*])\s*/, "").trim())
    .filter((l) => l && /[a-z]/i.test(l) && !/:\s*$/.test(l) && !/^waiters?(\s+list)?$/i.test(l))
    .map((l) => splitRole(l).name);
}

/** A rough sound-alike key: Sarvan/Sarwan, Bhaleswar/Baleshwardas and Pintoo/Pintu come out alike. */
function skeleton(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/v/g, "w")
    .replace(/h/g, "")
    .replace(/oo/g, "u")
    .replace(/ee/g, "i")
    .replace(/(.)\1+/g, "$1");
}

/** The person on Staff this name most likely is, or null. Only a single clear match counts (the owner can pick another). */
export function findMatch(name: string, people: Existing[]): number | null {
  const active = people.filter((p) => p.active);
  const tries: ((p: Existing) => boolean)[] = [
    (p) => p.name.trim().toLowerCase() === name.trim().toLowerCase(),
    (p) => skeleton(p.name) === skeleton(name),
    (p) => skeleton(p.name.split(/\s+/)[0]) === skeleton(name.split(/\s+/)[0]),
    (p) => {
      const a = skeleton(p.name), b = skeleton(name);
      return Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a));
    },
  ];
  for (const test of tries) {
    const hits = active.filter(test);
    if (hits.length === 1) return hits[0].id;
    // The same name twice on Staff: take the one who is a waiter, if only one is, so no third copy gets added.
    if (hits.length > 1) {
      const waiters = hits.filter((p) => p.is_waiter);
      return waiters.length === 1 ? waiters[0].id : null;
    }
  }
  return null;
}

/** Same person, by the rules above, among rows not yet on Staff. */
const sameName = (a: string, b: string) => findMatch(a, [{ id: 1, name: b, active: true }]) === 1;

/** Builds the rows to check: everyone with a salary, then waiters who weren't in the salary list. */
export function buildRows(salaryText: string, waiterText: string, people: Existing[]): ImportRow[] {
  const rows: ImportRow[] = parseSalaries(salaryText).map((p) => ({
    ...p,
    waiter: p.role === "Waiter",
    match: findMatch(p.name, people),
  }));
  for (const w of parseNames(waiterText)) {
    const row = rows.find((r) => sameName(w, r.name) || sameName(r.name, w));
    if (row) {
      row.waiter = true;
      if (!row.role) row.role = "Waiter";
      // Someone new takes the waiter list's spelling, which is usually the fuller one ("Rohit Kumar" for "Rohit").
      if (row.match === null) row.name = w;
      continue;
    }
    rows.push({ name: w, role: "Waiter", salary: null, waiter: true, match: findMatch(w, people) });
  }
  return rows;
}
