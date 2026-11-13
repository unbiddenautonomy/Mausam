-- Mausam admin: first schema. Money is in paise (integer). Dates are business dates 'YYYY-MM-DD' (5 am to 5 am IST).

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','staff')),
  pin_hash TEXT NOT NULL,
  pin_salt TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  active INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_local TEXT,
  role TEXT NOT NULL DEFAULT '',
  phone TEXT,
  pay_type TEXT CHECK (pay_type IN ('monthly','daily','shift')),
  pay_rate INTEGER,
  joined_on TEXT,
  user_id INTEGER REFERENCES users(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE expense_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  name_hi TEXT,
  name_kn TEXT,
  sort INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE shopping_trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_date TEXT NOT NULL,
  manager_id INTEGER NOT NULL REFERENCES users(id),
  float_out INTEGER NOT NULL,
  float_back INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);
CREATE INDEX idx_trips_date ON shopping_trips(business_date);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_date TEXT NOT NULL,
  trip_id INTEGER REFERENCES shopping_trips(id),
  category_id INTEGER NOT NULL REFERENCES expense_categories(id),
  shop TEXT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  mode TEXT NOT NULL DEFAULT 'cash' CHECK (mode IN ('cash','online')),
  has_receipt INTEGER NOT NULL DEFAULT 0,
  photo_key TEXT,
  note TEXT,
  client_id TEXT UNIQUE, -- lets an offline phone retry without creating duplicates
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX idx_expenses_date ON expenses(business_date);

CREATE TABLE day_closes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_date TEXT NOT NULL UNIQUE,
  total_counter INTEGER NOT NULL,
  cash INTEGER NOT NULL,
  online INTEGER NOT NULL,
  expenses INTEGER NOT NULL,
  pos_sales INTEGER,
  note TEXT,
  memo_photo_key TEXT,
  pos_photo_key TEXT,
  flags TEXT NOT NULL DEFAULT '[]',
  late INTEGER NOT NULL DEFAULT 0,
  submitted_by INTEGER NOT NULL REFERENCES users(id),
  submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  business_date TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warn',
  params TEXT NOT NULL DEFAULT '{}',
  audience TEXT NOT NULL DEFAULT 'owner', -- 'owner' | 'manager' | 'all'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  seen_at TEXT,
  seen_by INTEGER REFERENCES users(id),
  UNIQUE (type, business_date)
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_id INTEGER NOT NULL,
  action TEXT NOT NULL, -- create | update | delete
  before TEXT,
  after TEXT,
  user_id INTEGER REFERENCES users(id),
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO expense_categories (key, name_en, name_hi, name_kn, sort) VALUES
  ('vegetables', 'Vegetables', 'सब्ज़ी', 'ತರಕಾರಿ', 10),
  ('dairy', 'Dairy (milk, paneer, butter)', 'डेयरी (दूध, पनीर, मक्खन)', 'ಹಾಲಿನ ಉತ್ಪನ್ನ', 20),
  ('bakery', 'Bakery (pav, bread)', 'बेकरी (पाव, ब्रेड)', 'ಬೇಕರಿ (ಪಾವ್, ಬ್ರೆಡ್)', 30),
  ('grocery', 'Grocery and masala', 'किराना और मसाला', 'ದಿನಸಿ ಮತ್ತು ಮಸಾಲೆ', 40),
  ('oil', 'Oil and ghee', 'तेल और घी', 'ಎಣ್ಣೆ ಮತ್ತು ತುಪ್ಪ', 50),
  ('gas', 'Gas cylinders', 'गैस सिलेंडर', 'ಗ್ಯಾಸ್ ಸಿಲಿಂಡರ್', 60),
  ('drinks', 'Cold drinks and water', 'कोल्ड ड्रिंक और पानी', 'ತಂಪು ಪಾನೀಯ ಮತ್ತು ನೀರು', 70),
  ('disposables', 'Parcel boxes and disposables', 'पार्सल डिब्बे', 'ಪಾರ್ಸೆಲ್ ಡಬ್ಬಿಗಳು', 80),
  ('cleaning', 'Cleaning', 'सफ़ाई', 'ಸ್ವಚ್ಛತೆ', 90),
  ('staff_advance', 'Staff advance', 'स्टाफ़ एडवांस', 'ಸಿಬ್ಬಂದಿ ಮುಂಗಡ', 100),
  ('staff_food', 'Staff food and tea', 'स्टाफ़ खाना और चाय', 'ಸಿಬ್ಬಂದಿ ಊಟ ಮತ್ತು ಚಹಾ', 110),
  ('repairs', 'Repairs and maintenance', 'मरम्मत', 'ದುರಸ್ತಿ', 120),
  ('transport', 'Transport', 'आना-जाना', 'ಸಾರಿಗೆ', 130),
  ('other', 'Other', 'अन्य', 'ಇತರೆ', 999);
