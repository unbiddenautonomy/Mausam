// Generates DEMO data (5 weeks of closings and expenses) for trying the app locally.
// Usage: node scripts/demo-seed.mjs > /tmp/demo.sql && wrangler d1 execute mausam --local --file /tmp/demo.sql
// Never run this against the real (remote) database.
// Logins created: owner 9000000001 / PIN 1234, managers 9000000002 and 9000000003 / PIN 1111,
// POS counter (staff role) 9000000004 / PIN 2222.

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
  ["Counter", "9000000004", "staff", "2222", "en"], // logs in on the POS
];
for (const [i, [name, phone, role, pin, lang]] of users.entries()) {
  const { hash, salt } = await pinHash(pin);
  out.push(`INSERT INTO users (id, name, phone, role, pin_hash, pin_salt, language) VALUES (${i + 1}, ${q(name)}, ${q(phone)}, ${q(role)}, ${q(hash)}, ${q(salt)}, ${q(lang)});`);
}

const staff = [
  ["Rohit Kumar", "रोहित कुमार", "Waiter", "monthly", 1400000, null],
  ["Saroj Kumar", "सरोज कुमार", "Waiter", "monthly", 1400000, null],
  ["Pintu", "पिंटू", "Waiter", "monthly", null, null],
  ["Sarwan", "सरवन", "Cook", "monthly", 2200000, null],
  ["Sanjay", "संजय", "Helper", "daily", 60000, null],
  ["Manju", "ಮಂಜು", "Cook", "monthly", 1800000, null],
  ["Ravi", "ರವಿ", "Tandoor", "monthly", 2000000, null],
  ["Lakshmi", "ಲಕ್ಷ್ಮಿ", "Cleaning", "daily", 50000, null],
  ["Deepak", "दीपक", "Waiter", "monthly", 1300000, addDays(today, -12)],
  ["Imran", "इमरान", "Helper", "shift", 35000, null],
];
for (const s of staff) out.push(`INSERT INTO staff (name, name_local, role, pay_type, pay_rate, joined_on) VALUES (${s.map(q).join(", ")});`);

// Attendance: mostly present, one weekly day off each, a few absences and half days. Yesterday left unmarked.
for (let i = 35; i >= 2; i--) {
  const d = addDays(today, -i);
  const dow = new Date(d).getUTCDay();
  staff.forEach((s, idx) => {
    if (s[5] && d < s[5]) return;
    const r = rand();
    const status = dow === (idx % 6) + 1 ? "off" : r < 0.04 ? "absent" : r < 0.07 ? "half" : r < 0.08 ? "leave" : "present";
    out.push(`INSERT INTO attendance (staff_id, business_date, status, marked_by) VALUES (${idx + 1}, ${q(d)}, ${q(status)}, 2);`);
  });
}

// Vendors with standing deals. Deliveries on schedule, paid weekly; one delivery charged above the deal.
const vendors = [
  { name: "Sri Balaji Beverages", terms: "weekly", opening: 450000, items: [["Coke 300 ml", "crate", 72000, 2, "1,4"], ["Sprite 300 ml", "crate", 72000, 1, "1,4"]] },
  { name: "Modern Bakery", terms: "weekly", opening: 0, items: [["Bread loaf", "pcs", 3500, 12, "0,1,2,3,4,5,6"], ["Pav", "dozen", 4800, 10, "0,1,2,3,4,5,6"]] },
  { name: "Nandini Milk Parlour", terms: "monthly", opening: 1250000, items: [["Milk", "litre", 4400, 30, "0,1,2,3,4,5,6"], ["Butter 500 g", "pcs", 28500, 2, "3,6"]] },
];
let itemId = 0;
vendors.forEach((v, vi) => {
  const vid = vi + 1;
  out.push(`INSERT INTO vendors (id, name, payment_terms, opening_due, category_id) VALUES (${vid}, ${q(v.name)}, ${q(v.terms)}, ${v.opening}, ${vi === 0 ? 7 : vi === 1 ? 3 : 2});`);
  for (const [item, unit, rate, usual, days] of v.items) {
    itemId++;
    out.push(`INSERT INTO vendor_items (id, vendor_id, item, unit, agreed_rate, usual_qty, delivery_days) VALUES (${itemId}, ${vid}, ${q(item)}, ${q(unit)}, ${rate}, ${usual}, ${q(days)});`);
    for (let i = 35; i >= 1; i--) {
      const d = addDays(today, -i);
      if (!days.split(",").includes(String(new Date(d).getUTCDay()))) continue;
      const qty = Math.max(1, Math.round(usual * (0.8 + rand() * 0.4)));
      const charged = item === "Coke 300 ml" && i <= 6 ? 76000 : rate;
      out.push(`INSERT INTO deliveries (vendor_id, item_id, business_date, item, unit, qty, rate, amount, agreed_rate, created_by) VALUES (${vid}, ${itemId}, ${q(d)}, ${q(item)}, ${q(unit)}, ${qty}, ${charged}, ${qty * charged}, ${rate}, 3);`);
      if (charged !== rate && i === 3) out.push(`INSERT INTO alerts (type, business_date, severity, params) VALUES ('rate_mismatch:demo', ${q(d)}, 'warn', ${q(JSON.stringify({ vendor: v.name, category: item, amount: charged, usual: rate }))});`);
    }
  }
  // Weekly payments by bank transfer (the milk vendor is paid monthly).
  for (let i = 34; i >= 1; i -= v.terms === "weekly" ? 7 : 30) {
    const amount = vi === 0 ? 420000 + round(rand() * 40000, 10000) : vi === 1 ? 620000 : 2000000;
    out.push(`INSERT INTO vendor_payments (vendor_id, business_date, amount, mode, created_by) VALUES (${vid}, ${q(addDays(today, -i))}, ${amount}, 'online', 1);`);
  }
});

// Monthly bills paid online.
const thisMonth = today.slice(0, 7);
const lastMonth = addDays(thisMonth + "-01", -1).slice(0, 7);
for (const [m, day] of [[lastMonth, "05"], [thisMonth, "05"]]) {
  if (`${m}-${day}` > today) continue;
  out.push(`INSERT INTO expenses (business_date, category_id, amount, mode, has_receipt, note, created_by) VALUES (${q(`${m}-${day}`)}, 16, 12000000, 'online', 1, 'Rent', 1);`);
}
out.push(`INSERT INTO expenses (business_date, category_id, amount, mode, has_receipt, created_by) VALUES (${q(`${lastMonth}-12`)}, 17, 3820000, 'online', 1, 1);`);
out.push(`INSERT INTO expenses (business_date, category_id, amount, mode, has_receipt, created_by) VALUES (${q(`${lastMonth}-12`)}, 18, 450000, 'online', 1, 1);`);

// POS menu for item sales: name, category, price (₹), popularity weight.
const menu = [
  ["Chicken Biryani", "Biryani", 260, 9], ["Veg Biryani", "Biryani", 200, 4], ["Mutton Biryani", "Biryani", 340, 3],
  ["Paneer Butter Masala", "Curries", 240, 6], ["Butter Chicken", "Curries", 290, 7], ["Dal Tadka", "Curries", 160, 6], ["Kadai Paneer", "Curries", 250, 3],
  ["Butter Naan", "Breads", 50, 18], ["Tandoori Roti", "Breads", 30, 14], ["Garlic Naan", "Breads", 70, 6],
  ["Chicken 65", "Starters", 230, 6], ["Gobi Manchurian", "Starters", 170, 5], ["Paneer Tikka", "Starters", 250, 4], ["Tandoori Chicken (half)", "Starters", 280, 4],
  ["Veg Fried Rice", "Chinese", 170, 4], ["Chicken Noodles", "Chinese", 190, 4],
  ["Masala Dosa", "South Indian", 90, 8], ["Idli Vada", "South Indian", 70, 6],
  ["Sweet Lassi", "Drinks", 80, 6], ["Coke", "Drinks", 40, 9], ["Fresh Lime Soda", "Drinks", 70, 5], ["Filter Coffee", "Drinks", 30, 7],
  ["Gulab Jamun", "Desserts", 60, 4], ["Kulfi", "Desserts", 80, 2],
];
const weightSum = menu.reduce((s, m) => s + m[2] * m[3], 0);

// Category ids follow the seed order in 0001_init.sql.
const cat = { vegetables: 1, dairy: 2, bakery: 3, grocery: 4, oil: 5, gas: 6, drinks: 7, disposables: 8, cleaning: 9, staff_advance: 10, staff_food: 11, repairs: 12, transport: 13, other: 14 };
const shops = { vegetables: "KR Market", dairy: "Nandini", bakery: "Pav supplier", grocery: "Kirana store", oil: "Oil depot", gas: "Gas agency", drinks: "Coke distributor", disposables: "Packaging shop" };

let tripId = 0;
for (let i = 35; i >= 1; i--) {
  const d = addDays(today, -i);
  const dow = new Date(d).getUTCDay();
  if (i === 9) continue; // one missing closing
  const weekend = dow === 0 || dow === 6 ? 1.35 : dow === 5 ? 1.15 : 1;
  const total = round((52_000 + rand() * 16_000) * weekend * 100 * (1 + (35 - i) * 0.004));

  // Morning shopping trip + expenses
  tripId++;
  const lines = [
    ["vegetables", 3200 + rand() * 2000],
    ["dairy", 6000 + rand() * 2000],
    ["grocery", 2500 + rand() * 2500],
    ["gas", dow === 2 || dow === 5 ? 13_800 : 0],
    ["oil", rand() < 0.25 ? 10_600 : 0],
    ["disposables", 1500 + rand() * 1500],
    ["staff_food", 800 + rand() * 400],
  ];
  if (i === 4) lines[0][1] = 14_200; // a spike to show the anomaly flag
  const exps = lines.filter(([, a]) => a > 0).map(([k, a]) => [k, round(a * 100)]);
  // Two vegetable lines with quantities, so price watch has something to show (tomatoes getting dearer).
  const tomatoRate = round((30 + (35 - i) * 0.9 + rand() * 4) * 100, 100);
  const onionRate = round((38 + rand() * 6) * 100, 100);
  const tripCash = exps.filter(([k]) => !["staff_advance", "staff_food"].includes(k));
  const spent = tripCash.reduce((s, [, a]) => s + a, 0) + tomatoRate * 8 + onionRate * 10;
  const floatOut = Math.ceil(spent / 500_000) * 500_000 + 500_000;
  out.push(`INSERT INTO shopping_trips (id, business_date, manager_id, float_out, float_back, status, closed_at, created_at) VALUES (${tripId}, ${q(d)}, 3, ${floatOut}, ${floatOut - spent}, 'closed', ${q(d + " 05:30:00")}, ${q(d + " 03:00:00")});`);
  for (const [k, a] of exps) {
    const inTrip = !["staff_advance", "staff_food"].includes(k);
    const receipt = k === "vegetables" ? (rand() < 0.5 ? 1 : 0) : k === "staff_food" || k === "staff_advance" ? 0 : 1;
    out.push(`INSERT INTO expenses (business_date, trip_id, category_id, shop, amount, mode, has_receipt, created_by, created_at) VALUES (${q(d)}, ${inTrip ? tripId : "NULL"}, ${cat[k]}, ${q(shops[k] ?? null)}, ${a}, 'cash', ${receipt}, ${inTrip ? 3 : 2}, ${q(d + " 04:00:00")});`);
  }
  out.push(`INSERT INTO expenses (business_date, trip_id, category_id, shop, amount, mode, has_receipt, created_by, item, qty, unit) VALUES (${q(d)}, ${tripId}, 1, 'KR Market', ${tomatoRate * 8}, 'cash', 1, 3, 'Tomatoes', 8, 'kg');`);
  out.push(`INSERT INTO expenses (business_date, trip_id, category_id, shop, amount, mode, has_receipt, created_by, item, qty, unit) VALUES (${q(d)}, ${tripId}, 1, 'KR Market', ${onionRate * 10}, 'cash', 1, 3, 'Onions', 10, 'kg');`);
  exps.push(["vegetables", tomatoRate * 8], ["vegetables", onionRate * 10]);
  // An advance from the counter now and then.
  if (rand() < 0.18) {
    const who = 1 + Math.floor(rand() * 8);
    const amt = 200000 + round(rand() * 300000, 50000);
    out.push(`INSERT INTO expenses (business_date, category_id, amount, mode, has_receipt, created_by, source, note) VALUES (${q(d)}, 10, ${amt}, 'cash', 0, 2, 'advance', ${q(staff[who - 1][0])});`);
    out.push(`INSERT INTO advances (staff_id, business_date, amount, from_counter, expense_id, given_by) VALUES (${who}, ${q(d)}, ${amt}, 1, last_insert_rowid(), 2);`);
    exps.push(["staff_advance", amt]);
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
  // POS export for the day: items scaled to the day's sales; on one day the POS total is ₹1,200 higher.
  const posTotal = i === 8 ? total + 120_000 : total;
  out.push(`INSERT INTO pos_daily (business_date, total, cash, online, bills) VALUES (${q(d)}, ${posTotal}, ${posTotal - online}, ${online}, ${Math.round(total / 45000)});`);
  if (i === 8) out.push(`UPDATE day_closes SET pos_sales = ${posTotal}, flags = ${q(JSON.stringify([...flags, { code: "pos_differs", diff: -120_000 }]))} WHERE business_date = ${q(d)};`);
  let itemsTotal = 0;
  const scale = total / 100 / weightSum;
  for (const [name, catName, price, w] of menu) {
    const qty = Math.max(0, Math.round(w * scale * (0.75 + rand() * 0.5) * (catName === "South Indian" && (dow === 0 || dow === 6) ? 1.6 : 1)));
    if (!qty) continue;
    itemsTotal += qty * price * 100;
    out.push(`INSERT INTO pos_items (business_date, item, category, qty, amount) VALUES (${q(d)}, ${q(name)}, ${q(catName)}, ${qty}, ${qty * price * 100});`);
  }
  if (flags.some((f) => f.code === "formula_mismatch")) out.push(`INSERT INTO alerts (type, business_date, severity, params) VALUES ('close_flag', ${q(d)}, 'warn', '{"count":1}');`);
}
out.push(`INSERT INTO alerts (type, business_date, severity, params, audience) VALUES ('close_missing', ${q(addDays(today, -9))}, 'critical', ${q(JSON.stringify({ date: addDays(today, -9) }))}, 'all');`);

// ---- POS: tables (demo). The real Mausam menu comes from migration 0007, so it isn't seeded here. ----
let tableSort = 0;
for (let n = 1; n <= 15; n++) out.push(`INSERT INTO dining_tables (area, name, seats, sort) VALUES ('Garden', 'C${n}', 6, ${++tableSort});`);
for (let n = 1; n <= 7; n++) out.push(`INSERT INTO dining_tables (area, name, seats, sort) VALUES ('Rooftop', 'D${n}', 4, ${++tableSort});`);

// Waiters: IDs for the POS, a 2% default commission, and one waiter on 3%.
let code = 0;
staff.forEach((s, i) => {
  if (s[2] === "Waiter") out.push(`UPDATE staff SET is_waiter = 1, waiter_code = '${++code}' WHERE id = ${i + 1};`);
});
out.push("UPDATE staff SET commission_bp = 300 WHERE id = 1;");
out.push("INSERT INTO settings (key, value) VALUES ('pos_commission_bp', '200') ON CONFLICT (key) DO UPDATE SET value = excluded.value;");

console.log(out.join("\n"));
