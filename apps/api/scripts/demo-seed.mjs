// Generates DEMO data (5 weeks of closings and expenses) for trying the app locally.
// Usage: node scripts/demo-seed.mjs > /tmp/demo.sql && wrangler d1 execute mausam --local --file /tmp/demo.sql
// Never run this against the real (remote) database.
// Logins created: owner 9000000001 / PIN 1234, managers 9000000002 and 9000000003 / PIN 1111.

import { webcrypto as crypto } from "node:crypto";

const IST = 330 * 60_000;
const now = new Date();
const ist = new Date(now.getTime() + IST);
let today = ist.toISOString().slice(0, 10);
if (ist.getUTCHours() < 5) today = new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const round = (x, to = 1000) => Math.round(x / to) * to; // paise rounded to ₹10

async function pinHash(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, key, 256);
  const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
  return { hash: hex(bits), salt: hex(salt) };
}

const out = [];
const q = (v) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

const users = [
  ["Nachi", "9000000001", "owner", "1234", "en"],
  ["Manager 1", "9000000002", "manager", "1111", "kn"],
  ["Manager 2", "9000000003", "manager", "1111", "hi"],
];
for (const [i, [name, phone, role, pin, lang]] of users.entries()) {
  const { hash, salt } = await pinHash(pin);
  out.push(`INSERT INTO users (id, name, phone, role, pin_hash, pin_salt, language) VALUES (${i + 1}, ${q(name)}, ${q(phone)}, ${q(role)}, ${q(hash)}, ${q(salt)}, ${q(lang)});`);
}

const staff = [
  ["Rohit Kumar", "रोहित कुमार", "Waiter", "monthly", 1400000],
  ["Saroj Kumar", "सरोज कुमार", "Waiter", "monthly", 1400000],
  ["Pintu", "पिंटू", "Waiter", "monthly", null],
  ["Sarwan", "सरवन", "Cook", "monthly", 2200000],
  ["Sanjay", "संजय", "Helper", "daily", 60000],
];
for (const s of staff) out.push(`INSERT INTO staff (name, name_local, role, pay_type, pay_rate) VALUES (${s.map(q).join(", ")});`);

// Category ids follow the seed order in 0001_init.sql.
const cat = { vegetables: 1, dairy: 2, bakery: 3, grocery: 4, oil: 5, gas: 6, drinks: 7, disposables: 8, cleaning: 9, staff_advance: 10, staff_food: 11, repairs: 12, transport: 13, other: 14 };
const shops = { vegetables: "KR Market", dairy: "Nandini", bakery: "Pav supplier", grocery: "Kirana store", oil: "Oil depot", gas: "Gas agency", drinks: "Coke distributor", disposables: "Packaging shop" };

let tripId = 0;
for (let i = 35; i >= 1; i--) {
  const d = addDays(today, -i);
  const dow = new Date(d).getUTCDay();
  if (i === 9) continue; // one missing closing
  const weekend = dow === 0 || dow === 6 ? 1.35 : dow === 5 ? 1.15 : 1;
  const total = round((95_000 + rand() * 30_000) * weekend * 100 * (1 + (35 - i) * 0.004));

  // Morning shopping trip + expenses
  tripId++;
  const lines = [
    ["vegetables", 5200 + rand() * 2500],
    ["dairy", 6000 + rand() * 2000],
    ["bakery", 2300 + rand() * 600],
    ["grocery", 2500 + rand() * 2500],
    ["drinks", rand() < 0.3 ? 9000 + rand() * 3000 : 0],
    ["gas", dow === 2 || dow === 5 ? 13_800 : 0],
    ["oil", rand() < 0.25 ? 10_600 : 0],
    ["disposables", 1500 + rand() * 1500],
    ["staff_food", 800 + rand() * 400],
    ["staff_advance", rand() < 0.2 ? 2000 + round(rand() * 3000, 500) : 0],
  ];
  if (i === 4) lines[0][1] = 14_200; // a spike to show the anomaly flag
  const exps = lines.filter(([, a]) => a > 0).map(([k, a]) => [k, round(a * 100)]);
  const tripCash = exps.filter(([k]) => !["staff_advance", "staff_food"].includes(k));
  const spent = tripCash.reduce((s, [, a]) => s + a, 0);
  const floatOut = Math.ceil(spent / 500_000) * 500_000 + 500_000;
  out.push(`INSERT INTO shopping_trips (id, business_date, manager_id, float_out, float_back, status, closed_at, created_at) VALUES (${tripId}, ${q(d)}, 3, ${floatOut}, ${floatOut - spent}, 'closed', ${q(d + " 05:30:00")}, ${q(d + " 03:00:00")});`);
  for (const [k, a] of exps) {
    const inTrip = !["staff_advance", "staff_food"].includes(k);
    const receipt = k === "vegetables" ? (rand() < 0.5 ? 1 : 0) : k === "staff_food" || k === "staff_advance" ? 0 : 1;
    out.push(`INSERT INTO expenses (business_date, trip_id, category_id, shop, amount, mode, has_receipt, created_by, created_at) VALUES (${q(d)}, ${inTrip ? tripId : "NULL"}, ${cat[k]}, ${q(shops[k] ?? null)}, ${a}, 'cash', ${receipt}, ${inTrip ? 3 : 2}, ${q(d + " 04:00:00")});`);
  }
  const expenses = exps.reduce((s, [, a]) => s + a, 0);
  const online = round(total * (0.36 + rand() * 0.12));
  let cash = total - online - expenses;
  const flags = [];
  if (i === 6) {
    cash -= 60_000; // ₹600 short: formula mismatch
    flags.push({ code: "formula_mismatch", diff: -60_000 });
  }
  const late = i === 12 || i === 20 ? 1 : 0;
  if (late) flags.push({ code: "late" });
  const submitted = late ? `${addDays(d, 1)} 06:10:00` : `${d} 20:${String(5 + Math.floor(rand() * 40)).padStart(2, "0")}:00`;
  out.push(`INSERT INTO day_closes (business_date, total_counter, cash, online, expenses, flags, late, submitted_by, submitted_at) VALUES (${q(d)}, ${total}, ${cash}, ${online}, ${expenses}, ${q(JSON.stringify(flags))}, ${late}, 2, ${q(submitted)});`);
  if (flags.some((f) => f.code === "formula_mismatch")) out.push(`INSERT INTO alerts (type, business_date, severity, params) VALUES ('close_flag', ${q(d)}, 'warn', '{"count":1}');`);
}
out.push(`INSERT INTO alerts (type, business_date, severity, params, audience) VALUES ('close_missing', ${q(addDays(today, -9))}, 'critical', ${q(JSON.stringify({ date: addDays(today, -9) }))}, 'all');`);

console.log(out.join("\n"));
