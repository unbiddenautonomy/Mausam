-- Make the POS work like the counter's old POS: variations and add-ons on items, the menu names from
-- the English menu card, the old POS's extra items, one floor of tables, and a printed bill
-- for every order on the receipt printer.

-- Variations: pick one, each with its own price, e.g. [{"name":"Regular","price":12000},{"name":"Jain","price":12000}].
-- Add-ons: pick at most one, added to the price, e.g. [{"name":"Kadak","price":0}]. Both NULL = tap adds the item.
ALTER TABLE menu_items ADD COLUMN variations TEXT;
ALTER TABLE menu_items ADD COLUMN addons TEXT;

-- What was picked, kept on each bill line (the name stays the item's name).
ALTER TABLE pos_bill_items ADD COLUMN variation TEXT;
ALTER TABLE pos_bill_items ADD COLUMN modifier TEXT;

-- ---- Names as printed on the English menu card (prices were already right) ----
UPDATE menu_items SET name = 'Green Butter Pav Bhaji (Amul Butter)', name_hi = 'ग्रीन बटर पाव भाजी (अमूल बटर)', name_kn = 'ಗ್ರೀನ್ ಬಟರ್ ಪಾವ್ ಭಾಜಿ (ಅಮುಲ್ ಬಟರ್)' WHERE name = 'Green Pav Bhaji (Amul Butter)';
UPDATE menu_items SET name = 'Cheese Butter Bhaji (Amul Butter)', name_hi = 'चीज़ बटर भाजी (अमूल बटर)', name_kn = 'ಚೀಸ್ ಬಟರ್ ಭಾಜಿ (ಅಮುಲ್ ಬಟರ್)' WHERE name = 'Cheese Pav Bhaji (Amul Butter)';
UPDATE menu_items SET name = 'Lasan Chatni', name_hi = 'लसन चटनी', name_kn = 'ಲಸನ್ ಚಟ್ನಿ' WHERE name = 'Garlic Chutney';
UPDATE menu_items SET name = 'Green Lasan Chatni', name_hi = 'ग्रीन लसन चटनी', name_kn = 'ಗ್ರೀನ್ ಲಸನ್ ಚಟ್ನಿ' WHERE name = 'Green Garlic Chutney';
UPDATE menu_items SET name = '1 Lachka Pav (Amul Butter) (1 pc)', name_hi = '1 लचका पाव (अमूल बटर) (1 पीस)', name_kn = '1 ಲಚ್ಕಾ ಪಾವ್ (ಅಮುಲ್ ಬಟರ್) (1 ಪೀಸ್)' WHERE name = 'Lachka Pav (1 pc)';
UPDATE menu_items SET name = 'Chaas (Buttermilk)' WHERE name = 'Chaas';
UPDATE menu_items SET name = 'Gotalo (Amul Butter)', name_hi = 'गोटालो (अमूल बटर)', name_kn = 'ಗೋಟಾಲೋ (ಅಮುಲ್ ಬಟರ್)' WHERE name = 'Gotala Dosa (Amul Butter)';
UPDATE menu_items SET name = 'Cheese Paper (Amul Butter)', name_hi = 'चीज़ पेपर (अमूल बटर)', name_kn = 'ಚೀಸ್ ಪೇಪರ್ (ಅಮುಲ್ ಬಟರ್)' WHERE name = 'Cheese Paper Dosa (Amul Butter)';
UPDATE menu_items SET name = 'Paper (Oil)', name_hi = 'पेपर (तेल)', name_kn = 'ಪೇಪರ್ (ಎಣ್ಣೆ)' WHERE name = 'Paper Dosa (Oil)';
UPDATE menu_items SET name = 'Paper (Amul Butter)', name_hi = 'पेपर (अमूल बटर)', name_kn = 'ಪೇಪರ್ (ಅಮುಲ್ ಬಟರ್)' WHERE name = 'Paper Dosa (Amul Butter)';
UPDATE menu_items SET name = 'Singapore Rice', name_hi = 'सिंगापुर राइस', name_kn = 'ಸಿಂಗಾಪುರ್ ರೈಸ್' WHERE name = 'Singapuri Rice';
UPDATE menu_items SET name = 'Singapore Noodles', name_hi = 'सिंगापुर नूडल्स', name_kn = 'ಸಿಂಗಾಪುರ್ ನೂಡಲ್ಸ್' WHERE name = 'Singapuri Noodles';
UPDATE menu_items SET name = 'Veg. Fried Rice' WHERE name = 'Veg Fried Rice';
-- Manchurian comes Full or Half (and Jain), like the old POS, so the item is just "Manchurian".
UPDATE menu_items SET name = 'Manchurian', name_hi = 'मंचूरियन', name_kn = 'ಮಂಚೂರಿಯನ್' WHERE name = 'Manchurian Full';

-- Category names as on the old POS.
UPDATE menu_categories SET name = 'Soft Drink', name_hi = 'सॉफ्ट ड्रिंक', name_kn = 'ಸಾಫ್ಟ್ ಡ್ರಿಂಕ್' WHERE name = 'Drinks';

-- ---- Items the old POS sells that aren't on the card (prices from the old POS) ----
INSERT INTO menu_items (category_id, name, name_hi, name_kn, price, sort)
  SELECT (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1), 'Kora Pav', 'कोरा पाव', 'ಕೋರಾ ಪಾವ್', 500, COALESCE((SELECT sort FROM menu_items WHERE name = '1 Pav (Oil) (2 pcs)'), 1000) + (-4)
  WHERE (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM menu_items WHERE lower(name) = lower('Kora Pav'));
INSERT INTO menu_items (category_id, name, name_hi, name_kn, price, sort)
  SELECT (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1), '1 Pav (Oil) (1 pc)', '1 पाव (तेल) (1 पीस)', '1 ಪಾವ್ (ಎಣ್ಣೆ) (1 ಪೀಸ್)', 500, COALESCE((SELECT sort FROM menu_items WHERE name = '1 Pav (Oil) (2 pcs)'), 1000) + (-2)
  WHERE (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM menu_items WHERE lower(name) = lower('1 Pav (Oil) (1 pc)'));
INSERT INTO menu_items (category_id, name, name_hi, name_kn, price, sort)
  SELECT (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1), 'Bhaji Tikka', 'भाजी टिक्का', 'ಭಾಜಿ ಟಿಕ್ಕಾ', 20000, COALESCE((SELECT sort FROM menu_items WHERE name = 'Mausam Special Pav Bhaji'), 1000) + (5)
  WHERE (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM menu_items WHERE lower(name) = lower('Bhaji Tikka'));
INSERT INTO menu_items (category_id, name, name_hi, name_kn, price, sort)
  SELECT (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1), 'Mausam Special Pulav', 'मौसम स्पेशल पुलाव', 'ಮೌಸಮ್ ಸ್ಪೆಷಲ್ ಪುಲಾವ್', 40000, COALESCE((SELECT sort FROM menu_items WHERE name = 'Green Pulav (Amul Butter)'), 1000) + (5)
  WHERE (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM menu_items WHERE lower(name) = lower('Mausam Special Pulav'));
INSERT INTO menu_items (category_id, name, name_hi, name_kn, price, sort)
  SELECT (SELECT id FROM menu_categories WHERE name = 'Chinese' ORDER BY active DESC, id LIMIT 1), 'Manchurian Gravy', 'मंचूरियन ग्रेवी', 'ಮಂಚೂರಿಯನ್ ಗ್ರೇವಿ', 20000, COALESCE((SELECT sort FROM menu_items WHERE name = 'Manchurian'), 1000) + (5)
  WHERE (SELECT id FROM menu_categories WHERE name = 'Chinese' ORDER BY active DESC, id LIMIT 1) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM menu_items WHERE lower(name) = lower('Manchurian Gravy'));
INSERT INTO menu_items (category_id, name, name_hi, name_kn, price, sort)
  SELECT (SELECT id FROM menu_categories WHERE name = 'Soft Drink' ORDER BY active DESC, id LIMIT 1), 'Water', 'पानी', 'ನೀರು', 2000, COALESCE((SELECT sort FROM menu_items WHERE name = 'Chaas (Buttermilk)'), 1000) + (5)
  WHERE (SELECT id FROM menu_categories WHERE name = 'Soft Drink' ORDER BY active DESC, id LIMIT 1) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM menu_items WHERE lower(name) = lower('Water'));
INSERT INTO menu_items (category_id, name, name_hi, name_kn, price, sort)
  SELECT (SELECT id FROM menu_categories WHERE name = 'Soft Drink' ORDER BY active DESC, id LIMIT 1), 'Water Bottle Small', 'पानी की छोटी बोतल', 'ಸಣ್ಣ ನೀರಿನ ಬಾಟಲ್', 1000, COALESCE((SELECT sort FROM menu_items WHERE name = 'Chaas (Buttermilk)'), 1000) + (6)
  WHERE (SELECT id FROM menu_categories WHERE name = 'Soft Drink' ORDER BY active DESC, id LIMIT 1) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM menu_items WHERE lower(name) = lower('Water Bottle Small'));

-- ---- Variations and add-ons ----
-- Every dosa: Regular or Jain (same price), and how it's made: Kadak, Medium, Naram, or Plain.
UPDATE menu_items SET
  variations = json_array(json_object('name', 'Regular', 'price', price), json_object('name', 'Jain', 'price', price)),
  addons = json_array(
    json_object('name', 'Kadak', 'price', 0), json_object('name', 'Medium', 'price', 0), json_object('name', 'Naram', 'price', 0),
    json_object('name', 'Plain Kadak', 'price', 0), json_object('name', 'Plain Medium', 'price', 0), json_object('name', 'Plain Naram', 'price', 0))
WHERE variations IS NULL AND category_id = (SELECT id FROM menu_categories WHERE name = 'Dosa' ORDER BY active DESC, id LIMIT 1);

-- Every bhaji: Regular or Jain, same price. Not plain Pav Bhaji, which has Jain Bhaji (₹300) as its own item.
UPDATE menu_items SET variations = json_array(json_object('name', 'Regular', 'price', price), json_object('name', 'Jain', 'price', price))
WHERE variations IS NULL AND name LIKE '%Bhaji%' AND name NOT IN ('Jain Bhaji', 'Pav Bhaji')
  AND category_id = (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1);

-- Manchurian: Full or Half, each also Jain. Half is ₹150, as on the old POS.
UPDATE menu_items SET variations = json_array(
    json_object('name', 'Full', 'price', price), json_object('name', 'Half', 'price', 15000),
    json_object('name', 'Full Jain', 'price', price), json_object('name', 'Half Jain', 'price', 15000))
WHERE variations IS NULL AND name = 'Manchurian';

-- Favourites, starred as on the old POS.
UPDATE menu_items SET favourite = 1 WHERE name IN ('Pav Bhaji', 'Jain Bhaji', '1 Pav (Oil) (1 pc)', '1 Pav (Amul Butter) (1 pc)');

-- ---- Tables: one floor, T1–T22, only if none are set up yet (renamed or removed in Manage → Tables) ----
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 22)
INSERT INTO dining_tables (area, name, seats, sort)
SELECT 'Restaurant', 'T' || i, 4, i FROM n
WHERE NOT EXISTS (SELECT 1 FROM dining_tables);

-- ---- Printer and table map on; the bill heading and footer as on the old receipt (unless the owner already changed them) ----
INSERT INTO settings (key, value) VALUES ('pos_printing', '1'), ('pos_use_tables', '1')
ON CONFLICT (key) DO UPDATE SET value = excluded.value;
UPDATE settings SET value = 'MAUSAM RESTAURANT
Mausam Restaurant, Green house, Lajamani Chowk, Mota Varachha,
Contact No. :- +91 75750 55022'
WHERE key = 'pos_bill_header' AND value IN ('Mausam Restaurant', '');
UPDATE settings SET value = 'Thank You !! Visit Again !!' WHERE key = 'pos_bill_footer' AND value IN ('Thank you! Visit again.', '');
