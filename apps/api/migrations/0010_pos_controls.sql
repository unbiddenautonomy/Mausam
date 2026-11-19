-- Items taken off an order after the kitchen got them or after the bill was printed: where money can go missing.
-- The POS sends them with the bill. Bills from older POS screens have none.

CREATE TABLE pos_bill_voids (
  id INTEGER PRIMARY KEY,
  bill_id INTEGER NOT NULL REFERENCES pos_bills(id),
  name TEXT NOT NULL,
  variation TEXT,
  qty INTEGER NOT NULL,
  price INTEGER NOT NULL,            -- paise, for one
  stage TEXT NOT NULL,               -- 'kitchen' (already sent to the kitchen) or 'billed' (bill already printed)
  removed_at TEXT NOT NULL,          -- ISO time on the POS
  removed_by INTEGER                 -- the user logged in on that screen (not a foreign key, so an odd id never refuses a bill)
);
CREATE INDEX idx_pos_bill_voids_bill ON pos_bill_voids(bill_id);

-- Why a discount was given, and who allowed one above the staff limit. Older bills have neither.
ALTER TABLE pos_bills ADD COLUMN discount_reason TEXT;
ALTER TABLE pos_bills ADD COLUMN discount_approved_by INTEGER;
-- Things the owner should look at, as a JSON list (e.g. ["price_changed","old_date"]). NULL when there are none.
-- A flag never stops a bill from saving.
ALTER TABLE pos_bills ADD COLUMN flags TEXT;

-- How many times in a row an account was locked for wrong PINs. Each lock lasts twice as long, up to a day.
ALTER TABLE users ADD COLUMN lock_count INTEGER NOT NULL DEFAULT 0;

-- A bill given a new number because its first one was already used: the number on the paper copy, so it can be traced.
ALTER TABLE pos_bills ADD COLUMN printed_bill_no TEXT;

-- Bills the server refused, as the POS reported them, so the owner sees them even if nobody resends them.
-- resolved_at is set when the same bill (client_id) is later saved.
CREATE TABLE pos_bill_rejects (
  id INTEGER PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  bill_no TEXT,
  counter TEXT,
  business_date TEXT,
  total INTEGER,
  reason TEXT NOT NULL,
  data TEXT NOT NULL,                -- the bill as the POS has it (JSON)
  reported_by INTEGER,
  reported_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX idx_pos_bill_rejects_date ON pos_bill_rejects(business_date);

-- Which device uses each counter letter, so two devices can't both bill as "A". The owner can release a letter.
ALTER TABLE pos_counters ADD COLUMN device_id TEXT;
ALTER TABLE pos_counters ADD COLUMN claimed_at TEXT;

-- Who last changed a day's closing and when, so two people editing the same day can't overwrite each other unseen.
ALTER TABLE day_closes ADD COLUMN updated_at TEXT;
ALTER TABLE day_closes ADD COLUMN updated_by INTEGER;

-- A form sends one random id with each save, so a double tap or a re-send saves once (as expenses already do).
ALTER TABLE advances ADD COLUMN client_id TEXT;
ALTER TABLE deliveries ADD COLUMN client_id TEXT;
ALTER TABLE vendor_payments ADD COLUMN client_id TEXT;
CREATE UNIQUE INDEX idx_advances_client ON advances(client_id) WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX idx_deliveries_client ON deliveries(client_id) WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX idx_vendor_payments_client ON vendor_payments(client_id) WHERE client_id IS NOT NULL;

-- The last day someone worked, set when they're made inactive. They still get that month's pay sheet, up to this day.
ALTER TABLE staff ADD COLUMN left_on TEXT;
