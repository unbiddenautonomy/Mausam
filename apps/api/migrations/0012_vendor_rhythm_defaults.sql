-- How often a vendor bills us. payment_terms gains 'daily', 'every_2_days' and 'times_month' (with bills_per_month);
-- 'per_delivery' now reads "Lump sum or on delivery".
ALTER TABLE vendors ADD COLUMN bills_per_month INTEGER;

-- The vendors Mausam buys from, with how often each one bills. A vendor whose name is already there is left alone.
INSERT INTO vendors (name, category_id, payment_terms, bills_per_month)
  SELECT 'Water', (SELECT id FROM expense_categories WHERE key = 'drinks'), 'times_month', 3
  WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE lower(trim(name)) = lower('Water'));
INSERT INTO vendors (name, category_id, payment_terms, bills_per_month)
  SELECT 'Cold Drinks', (SELECT id FROM expense_categories WHERE key = 'drinks'), 'times_month', 2
  WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE lower(trim(name)) = lower('Cold Drinks'));
INSERT INTO vendors (name, category_id, payment_terms, bills_per_month)
  SELECT 'Oil', (SELECT id FROM expense_categories WHERE key = 'oil'), 'times_month', 4
  WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE lower(trim(name)) = lower('Oil'));
INSERT INTO vendors (name, category_id, payment_terms, bills_per_month)
  SELECT 'Karyanu / Grain', (SELECT id FROM expense_categories WHERE key = 'grocery'), 'times_month', 5
  WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE lower(trim(name)) = lower('Karyanu / Grain'));
INSERT INTO vendors (name, category_id, payment_terms, bills_per_month)
  SELECT 'Mukhwas', (SELECT id FROM expense_categories WHERE key = 'grocery'), 'per_delivery', NULL
  WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE lower(trim(name)) = lower('Mukhwas'));
INSERT INTO vendors (name, category_id, payment_terms, bills_per_month)
  SELECT 'Plastic box', (SELECT id FROM expense_categories WHERE key = 'disposables'), 'per_delivery', NULL
  WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE lower(trim(name)) = lower('Plastic box'));
INSERT INTO vendors (name, category_id, payment_terms, bills_per_month)
  SELECT 'Butter + Cheese + Paneer', (SELECT id FROM expense_categories WHERE key = 'dairy'), 'every_2_days', NULL
  WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE lower(trim(name)) = lower('Butter + Cheese + Paneer'));
INSERT INTO vendors (name, category_id, payment_terms, bills_per_month)
  SELECT 'Gas', (SELECT id FROM expense_categories WHERE key = 'gas'), 'daily', NULL
  WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE lower(trim(name)) = lower('Gas'));
INSERT INTO vendors (name, category_id, payment_terms, bills_per_month)
  SELECT 'Pau', (SELECT id FROM expense_categories WHERE key = 'bakery'), 'daily', NULL
  WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE lower(trim(name)) = lower('Pau'));
INSERT INTO vendors (name, category_id, payment_terms, bills_per_month)
  SELECT 'Chaas / Butter Milk', (SELECT id FROM expense_categories WHERE key = 'dairy'), 'daily', NULL
  WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE lower(trim(name)) = lower('Chaas / Butter Milk'));
INSERT INTO vendors (name, category_id, payment_terms, bills_per_month)
  SELECT 'Sukka Lasan / Dry Garlic', (SELECT id FROM expense_categories WHERE key = 'vegetables'), 'daily', NULL
  WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE lower(trim(name)) = lower('Sukka Lasan / Dry Garlic'));
INSERT INTO vendors (name, category_id, payment_terms, bills_per_month)
  SELECT 'Cleaners', (SELECT id FROM expense_categories WHERE key = 'cleaning'), 'daily', NULL
  WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE lower(trim(name)) = lower('Cleaners'));
