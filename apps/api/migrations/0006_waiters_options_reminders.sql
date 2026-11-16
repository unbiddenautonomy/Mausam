-- Waiters and their commission, POS options (tables, GST and printing can be turned off),
-- and who gets each reminder.

-- A waiter is a staff member with is_waiter = 1. waiter_code is the short ID shown on the POS (e.g. 7 or W7).
-- commission_bp is their own commission in basis points (250 = 2.5%); NULL uses the POS default.
ALTER TABLE staff ADD COLUMN is_waiter INTEGER NOT NULL DEFAULT 0;
ALTER TABLE staff ADD COLUMN waiter_code TEXT;
ALTER TABLE staff ADD COLUMN commission_bp INTEGER;

-- Staff already set up with "waiter" in their role become waiters.
UPDATE staff SET is_waiter = 1 WHERE lower(role) LIKE '%waiter%' OR lower(role) LIKE '%steward%' OR lower(role) LIKE '%captain%';

-- The waiter's name, rate and commission are kept on each bill when it reaches the server,
-- so changing a waiter's % later doesn't rewrite past months.
ALTER TABLE pos_bills ADD COLUMN waiter_name TEXT;
ALTER TABLE pos_bills ADD COLUMN commission_bp INTEGER;
ALTER TABLE pos_bills ADD COLUMN commission INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_pos_bills_waiter ON pos_bills(waiter_staff_id, business_date);

-- Month-end pay includes the waiter's commission for the month.
ALTER TABLE payroll ADD COLUMN commission INTEGER NOT NULL DEFAULT 0;

-- POS options. Tables, GST and printing start switched off: the counter works with none of them.
INSERT INTO settings (key, value) VALUES
  ('pos_use_tables', '0'),
  ('pos_use_gst', '0'),
  ('pos_printing', '0'),
  ('pos_commission_bp', '0'),
  ('pos_waiter_required', '1')
ON CONFLICT (key) DO NOTHING;

-- Who gets each reminder: a comma-separated list of user ids. Empty = every manager.
INSERT INTO settings (key, value) VALUES
  ('remind_shopping_to', ''),
  ('remind_close_to', '')
ON CONFLICT (key) DO NOTHING;
