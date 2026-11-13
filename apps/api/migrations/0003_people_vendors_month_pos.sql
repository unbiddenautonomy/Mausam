-- Phase 2–4: memo reading, attendance and pay, vendors, month close, POS imports.

-- Where an expense came from. 'manual' = typed by a manager; others are created by the app
-- (an advance or a vendor payment paid from the counter) so the day's counter total still matches the memo.
ALTER TABLE expenses ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE expenses ADD COLUMN ref_id INTEGER;
ALTER TABLE expenses ADD COLUMN qty REAL;
ALTER TABLE expenses ADD COLUMN unit TEXT;

INSERT INTO expense_categories (key, name_en, name_hi, name_kn, sort) VALUES
  ('salaries', 'Salaries', 'वेतन', 'ಸಂಬಳ', 140),
  ('rent', 'Rent', 'किराया', 'ಬಾಡಿಗೆ', 150),
  ('electricity', 'Electricity', 'बिजली', 'ವಿದ್ಯುತ್', 160),
  ('water', 'Water', 'पानी', 'ನೀರು', 170),
  ('licences', 'Licences and fees', 'लाइसेंस और फ़ीस', 'ಪರವಾನಗಿ ಮತ್ತು ಶುಲ್ಕ', 180),
  ('vendor_payment', 'Vendor payment', 'विक्रेता भुगतान', 'ಮಾರಾಟಗಾರರ ಪಾವತಿ', 190);

-- ---------- Memo reading ----------
CREATE TABLE memo_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_date TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'daily', -- daily | monthly
  photo_key TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL, -- ok | failed
  result TEXT, -- JSON
  error TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_memo_reads_date ON memo_reads(business_date);

-- ---------- Attendance and pay ----------
CREATE TABLE attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  business_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present','half','absent','leave','off')),
  marked_by INTEGER REFERENCES users(id),
  marked_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (staff_id, business_date)
);
CREATE INDEX idx_attendance_date ON attendance(business_date);

CREATE TABLE advances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  business_date TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  mode TEXT NOT NULL DEFAULT 'cash',
  from_counter INTEGER NOT NULL DEFAULT 1,
  expense_id INTEGER REFERENCES expenses(id),
  note TEXT,
  given_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX idx_advances_staff ON advances(staff_id, business_date);

CREATE TABLE payroll (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  month TEXT NOT NULL, -- YYYY-MM
  pay_type TEXT,
  rate INTEGER,
  days_worked REAL NOT NULL DEFAULT 0,
  days_absent REAL NOT NULL DEFAULT 0,
  days_unmarked INTEGER NOT NULL DEFAULT 0,
  gross INTEGER NOT NULL DEFAULT 0,
  advances INTEGER NOT NULL DEFAULT 0,
  adjustment INTEGER NOT NULL DEFAULT 0,
  net INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','paid')),
  paid_on TEXT,
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (staff_id, month)
);

-- ---------- Vendors ----------
CREATE TABLE vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  category_id INTEGER REFERENCES expense_categories(id),
  payment_terms TEXT NOT NULL DEFAULT 'monthly', -- per_delivery | weekly | monthly
  opening_due INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE vendor_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  item TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'pcs',
  agreed_rate INTEGER NOT NULL, -- paise per unit
  usual_qty REAL,
  delivery_days TEXT, -- e.g. "1,3,5" (0 = Sunday)
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  item_id INTEGER REFERENCES vendor_items(id),
  business_date TEXT NOT NULL,
  item TEXT NOT NULL,
  unit TEXT,
  qty REAL NOT NULL CHECK (qty > 0),
  rate INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  agreed_rate INTEGER,
  photo_key TEXT,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX idx_deliveries_vendor ON deliveries(vendor_id, business_date);

CREATE TABLE vendor_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  business_date TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  mode TEXT NOT NULL DEFAULT 'cash',
  from_counter INTEGER NOT NULL DEFAULT 0,
  expense_id INTEGER REFERENCES expenses(id),
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

-- ---------- Month close ----------
CREATE TABLE month_closes (
  month TEXT PRIMARY KEY, -- YYYY-MM
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  tally_photo_key TEXT,
  tally_sales INTEGER,
  tally_expenses INTEGER,
  tally_wages INTEGER,
  note TEXT,
  totals TEXT, -- JSON snapshot taken when the month was closed
  closed_by INTEGER REFERENCES users(id),
  closed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- POS imports ----------
CREATE TABLE pos_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL, -- sales | items
  filename TEXT,
  from_date TEXT,
  to_date TEXT,
  rows INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE pos_daily (
  business_date TEXT PRIMARY KEY,
  total INTEGER NOT NULL,
  cash INTEGER,
  online INTEGER,
  bills INTEGER,
  dine_in INTEGER,
  parcel INTEGER,
  discount INTEGER,
  cancelled INTEGER,
  import_id INTEGER REFERENCES pos_imports(id)
);

CREATE TABLE pos_items (
  business_date TEXT NOT NULL,
  item TEXT NOT NULL,
  category TEXT,
  qty REAL NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL DEFAULT 0,
  import_id INTEGER REFERENCES pos_imports(id),
  PRIMARY KEY (business_date, item)
);

CREATE TABLE pos_mappings (
  kind TEXT PRIMARY KEY,
  mapping TEXT NOT NULL
);
