-- Touchscreen POS: menu, tables and bills. Money in paise. Bills are made on the counter (offline first)
-- and synced; client_id makes a re-sent bill a no-op.

CREATE TABLE menu_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_hi TEXT,
  name_kn TEXT,
  sort INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES menu_categories(id),
  name TEXT NOT NULL,
  short_name TEXT,             -- shorter label for the tile and the kitchen ticket
  price INTEGER NOT NULL CHECK (price >= 0),
  tax_rate INTEGER,            -- basis points (500 = 5%); NULL uses the POS default
  hsn TEXT,
  veg INTEGER NOT NULL DEFAULT 1,
  favourite INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_menu_items_cat ON menu_items(category_id);

CREATE TABLE dining_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  area TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  seats INTEGER NOT NULL DEFAULT 4,
  sort INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE pos_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL UNIQUE,
  bill_no TEXT NOT NULL UNIQUE,     -- counter code + running number, e.g. A-00042
  counter TEXT NOT NULL,
  business_date TEXT NOT NULL,
  order_type TEXT NOT NULL CHECK (order_type IN ('dine_in','parcel')),
  table_id INTEGER REFERENCES dining_tables(id),
  table_name TEXT,
  token INTEGER,
  waiter_staff_id INTEGER REFERENCES staff(id),
  guests INTEGER,
  subtotal INTEGER NOT NULL,        -- sum of lines before discount
  discount INTEGER NOT NULL DEFAULT 0,
  tax INTEGER NOT NULL DEFAULT 0,   -- GST included in (or added to) the total
  round_off INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,           -- what the guest pays
  prices_include_tax INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('paid','cancelled')),
  cancel_reason TEXT,
  opened_at TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_pos_bills_date ON pos_bills(business_date);

CREATE TABLE pos_bill_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL REFERENCES pos_bills(id),
  item_id INTEGER REFERENCES menu_items(id),
  name TEXT NOT NULL,
  category TEXT,
  qty INTEGER NOT NULL CHECK (qty > 0),
  price INTEGER NOT NULL,
  tax_rate INTEGER NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL,
  note TEXT
);
CREATE INDEX idx_pos_bill_items_bill ON pos_bill_items(bill_id);

CREATE TABLE pos_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL REFERENCES pos_bills(id),
  mode TEXT NOT NULL CHECK (mode IN ('cash','upi','card','other')),
  amount INTEGER NOT NULL
);
CREATE INDEX idx_pos_payments_bill ON pos_payments(bill_id);

-- Which counters exist and when each last synced (shown to the owner).
CREATE TABLE pos_counters (
  code TEXT PRIMARY KEY,
  name TEXT,
  last_seen_at TEXT,
  last_bill_no TEXT
);

-- pos_daily rows written from Mausam POS bills have source 'pos' (imports keep 'import').
ALTER TABLE pos_daily ADD COLUMN source TEXT NOT NULL DEFAULT 'import';

INSERT INTO settings (key, value) VALUES
  ('pos_gst_rate', '500'),
  ('pos_prices_include_tax', '1'),
  ('pos_gstin', ''),
  ('pos_bill_header', 'Mausam Restaurant'),
  ('pos_bill_footer', 'Thank you! Visit again.')
ON CONFLICT (key) DO NOTHING;
