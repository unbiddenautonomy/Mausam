-- The billing screen in the same order as the old POS (DevSoft) on the counter, tile by tile, with the old POS's
-- prices (the counter's current prices; the printed menu card is older). Asked for on 25-11-2026.
--
-- * Each category's items get the old POS's order (3 tiles a row). Items the old POS doesn't sell are hidden, not
--   deleted (switch them back on in Item Master); Butter Pav Bhaji stays, after the old POS's last tile.
-- * Bhaji Green comes Oil or Butter, each Regular or Jain (so Green Butter Pav Bhaji is now one of its choices).
-- * Every Chinese item is Regular or Jain. Manchurian, Chinese Bhel, Noodles and Veg. Fried Rice also come Full or
--   Half; Half is ₹100 less than Full for now (the owner sets the real price in Item Master).
-- * Favourites in the old POS's order, kept in fav_sort.
-- Safe to run on a menu the owner changed: an item that isn't found by name is just skipped (new ones are added).

ALTER TABLE menu_items ADD COLUMN fav_sort INTEGER;


-- ---- Pav Bhaji ----
UPDATE menu_items SET price = 500, sort = 10, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Kora Pav' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 22000, sort = 20, active = 1, favourite = 1, fav_sort = 3, updated_at = datetime('now') WHERE name = 'Pav Bhaji' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 500, sort = 30, active = 1, favourite = 1, fav_sort = 2, updated_at = datetime('now') WHERE name = '1 Pav (Oil) (1 pc)' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 1000, sort = 40, active = 1, favourite = 1, fav_sort = 1, updated_at = datetime('now') WHERE name = '1 Pav (Amul Butter) (1 pc)' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 30000, sort = 50, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Pulav (Oil)' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 32000, sort = 60, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Masala Pav (Oil)' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 20000, sort = 70, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Bhaji Tikka' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 30000, sort = 80, active = 1, favourite = 1, fav_sort = 4, updated_at = datetime('now') WHERE name = 'Jain Bhaji' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 33000, sort = 90, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Green Pav Bhaji (Oil)' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 27000, sort = 100, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Special Pav Bhaji (Oil)' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 40000, sort = 110, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Mausam Special Pulav' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 38000, sort = 120, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Paneer Butter Pav Bhaji (Amul Butter)' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 40000, sort = 130, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Gotala Pav Bhaji (Amul Butter)' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 32000, sort = 140, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Paneer Bhaji (Oil)' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 40000, sort = 150, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Cheese Paneer Butter Pav Bhaji (Amul Butter)' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 45000, sort = 160, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Cheese Butter Bhaji (Amul Butter)' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 45000, sort = 170, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Green Pulav (Amul Butter)' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET sort = 180, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Green Lasan Chatni' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 23000, sort = 190, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Lasan Chatni' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 40000, sort = 200, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Mausam Special Pav Bhaji' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 42000, sort = 210, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Paneer Bhurji (Amul Butter)' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 42000, sort = 220, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Sizzler Bhaji (Amul Butter)' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1);
INSERT INTO menu_items (category_id, name, name_hi, name_kn, price, sort) SELECT (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1), 'Bhaji Moli', 'भाजी मोली', 'ಭಾಜಿ ಮೋಲಿ', 22000, 230
  WHERE (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM menu_items WHERE lower(name) = lower('Bhaji Moli'));
UPDATE menu_items SET price = 22000, sort = 230, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Bhaji Moli' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 32000, sort = 240, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Butter Pav Bhaji' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Pav Bhaji' ORDER BY active DESC, id LIMIT 1);

-- ---- Dosa ----
INSERT INTO menu_items (category_id, name, name_hi, name_kn, price, sort) SELECT (SELECT id FROM menu_categories WHERE name = 'Dosa' ORDER BY active DESC, id LIMIT 1), 'Cheese Masala Dosa', 'चीज़ मसाला डोसा', 'ಚೀಸ್ ಮಸಾಲ ದೋಸೆ', 32000, 10
  WHERE (SELECT id FROM menu_categories WHERE name = 'Dosa' ORDER BY active DESC, id LIMIT 1) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM menu_items WHERE lower(name) = lower('Cheese Masala Dosa'));
UPDATE menu_items SET price = 32000, sort = 10, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Cheese Masala Dosa' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Dosa' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 22000, sort = 20, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Mysore Dosa (Oil)' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Dosa' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 9000, sort = 30, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Paper (Oil)' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Dosa' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 12000, sort = 40, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Paper (Amul Butter)' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Dosa' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 22000, sort = 50, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Masala Dosa (Oil)' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Dosa' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 40000, sort = 60, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Gotalo (Amul Butter)' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Dosa' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 20000, sort = 70, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Cheese Paper (Amul Butter)' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Dosa' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 37000, sort = 80, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Cheese Palak Paneer Masala Dosa (Amul Butter)' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Dosa' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET sort = 90, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Jini Roll' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Dosa' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 40000, sort = 100, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Paneer Cheese Surma (Amul Butter)' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Dosa' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 40000, sort = 110, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Paneer Tukda Mysore (Amul Butter)' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Dosa' ORDER BY active DESC, id LIMIT 1);

-- ---- Chinese ----
UPDATE menu_items SET price = 25000, sort = 10, active = 1, favourite = 1, fav_sort = 6, updated_at = datetime('now') WHERE name = 'Manchurian' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Chinese' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET name = 'Chinese Bhel', name_hi = 'चाइनीज़ भेल', name_kn = 'ಚೈನೀಸ್ ಭೇಲ್' WHERE name = 'Chinese Bhel Full'
  AND NOT EXISTS (SELECT 1 FROM menu_items WHERE name = 'Chinese Bhel');
UPDATE menu_items SET price = 26000, sort = 20, active = 1, favourite = 1, fav_sort = 5, updated_at = datetime('now') WHERE name = 'Chinese Bhel' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Chinese' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 30000, sort = 30, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Bombay Bhel' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Chinese' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 25000, sort = 40, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Manchurian Gravy' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Chinese' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 32000, sort = 50, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Green Manchurian' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Chinese' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 25000, sort = 60, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Manchow Soup' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Chinese' ORDER BY active DESC, id LIMIT 1);
INSERT INTO menu_items (category_id, name, name_hi, name_kn, price, sort) SELECT (SELECT id FROM menu_categories WHERE name = 'Chinese' ORDER BY active DESC, id LIMIT 1), 'Manchurian Rice Full', 'मंचूरियन राइस फुल', 'ಮಂಚೂರಿಯನ್ ರೈಸ್ ಫುಲ್', 27000, 70
  WHERE (SELECT id FROM menu_categories WHERE name = 'Chinese' ORDER BY active DESC, id LIMIT 1) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM menu_items WHERE lower(name) = lower('Manchurian Rice Full'));
UPDATE menu_items SET price = 27000, sort = 70, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Manchurian Rice Full' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Chinese' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET name = 'Noodles', name_hi = 'नूडल्स', name_kn = 'ನೂಡಲ್ಸ್' WHERE name = 'Noodles Full'
  AND NOT EXISTS (SELECT 1 FROM menu_items WHERE name = 'Noodles');
UPDATE menu_items SET price = 28000, sort = 80, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Noodles' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Chinese' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 30000, sort = 90, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Schezwan Noodles' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Chinese' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 30000, sort = 100, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Schezwan Rice' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Chinese' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 30000, sort = 110, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Singapore Noodles' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Chinese' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 30000, sort = 120, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Singapore Rice' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Chinese' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 40000, sort = 130, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Triple Rice' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Chinese' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 28000, sort = 140, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Veg. Fried Rice' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Chinese' ORDER BY active DESC, id LIMIT 1);
INSERT INTO menu_items (category_id, name, name_hi, name_kn, price, sort) SELECT (SELECT id FROM menu_categories WHERE name = 'Chinese' ORDER BY active DESC, id LIMIT 1), 'Manchurian Noodles', 'मंचूरियन नूडल्स', 'ಮಂಚೂರಿಯನ್ ನೂಡಲ್ಸ್', 27000, 150
  WHERE (SELECT id FROM menu_categories WHERE name = 'Chinese' ORDER BY active DESC, id LIMIT 1) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM menu_items WHERE lower(name) = lower('Manchurian Noodles'));
UPDATE menu_items SET price = 27000, sort = 150, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Manchurian Noodles' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Chinese' ORDER BY active DESC, id LIMIT 1);

-- ---- Soft Drink ----
UPDATE menu_items SET price = 2000, sort = 10, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Chaas (Buttermilk)' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Soft Drink' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 2000, sort = 20, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Cold Drinks' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Soft Drink' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 2000, sort = 30, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Water' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Soft Drink' ORDER BY active DESC, id LIMIT 1);
UPDATE menu_items SET price = 1000, sort = 40, active = 1, favourite = 0, fav_sort = NULL, updated_at = datetime('now') WHERE name = 'Water Bottle Small' AND category_id = (SELECT id FROM menu_categories WHERE name = 'Soft Drink' ORDER BY active DESC, id LIMIT 1);

-- ---- Not sold on the old POS: hidden ----
UPDATE menu_items SET active = 0, favourite = 0, updated_at = datetime('now') WHERE name IN ('Green Butter Pav Bhaji (Amul Butter)', 'Masala Pav (Amul Butter)', 'Pulav (Amul Butter)', '1 Pav (Oil) (2 pcs)', '1 Lachka Pav (Amul Butter) (1 pc)', 'Mysore Dosa (Amul Butter)', 'Masala Dosa (Amul Butter)');

-- ---- Choices ----
-- Regular / Jain at the item's (new) price: every bhaji and dosa that already had them, and the new bhaji and dosa.
UPDATE menu_items SET variations = json_array(json_object('name', 'Regular', 'price', price), json_object('name', 'Jain', 'price', price))
WHERE (json_array_length(variations) = 2 AND json_extract(variations, '$[0].name') = 'Regular' AND json_extract(variations, '$[1].name') = 'Jain')
   OR name IN ('Bhaji Moli', 'Cheese Masala Dosa');
-- The new dosa is made like every other dosa.
UPDATE menu_items SET addons = (SELECT addons FROM menu_items WHERE name = 'Masala Dosa (Oil)' AND addons IS NOT NULL LIMIT 1)
WHERE name = 'Cheese Masala Dosa' AND addons IS NULL;
-- Bhaji Green: Oil or Butter, each Regular or Jain. Butter is the old Green Butter Pav Bhaji's price.
UPDATE menu_items SET variations = json_array(
    json_object('name', 'Oil', 'price', price), json_object('name', 'Jain Oil', 'price', price),
    json_object('name', 'Butter', 'price', COALESCE((SELECT price FROM menu_items WHERE name = 'Green Butter Pav Bhaji (Amul Butter)'), price + 4000)),
    json_object('name', 'Jain Butter', 'price', COALESCE((SELECT price FROM menu_items WHERE name = 'Green Butter Pav Bhaji (Amul Butter)'), price + 4000))),
  addons = NULL
WHERE name = 'Green Pav Bhaji (Oil)';
-- Chinese: Regular or Jain only (no add-ons) ...
UPDATE menu_items SET variations = json_array(json_object('name', 'Regular', 'price', price), json_object('name', 'Jain', 'price', price)), addons = NULL
WHERE category_id = (SELECT id FROM menu_categories WHERE name = 'Chinese' ORDER BY active DESC, id LIMIT 1);
-- ... and Full or Half for these four, Half ₹100 less.
UPDATE menu_items SET variations = json_array(
    json_object('name', 'Full', 'price', price), json_object('name', 'Half', 'price', price - 10000),
    json_object('name', 'Full Jain', 'price', price), json_object('name', 'Half Jain', 'price', price - 10000)), addons = NULL
WHERE category_id = (SELECT id FROM menu_categories WHERE name = 'Chinese' ORDER BY active DESC, id LIMIT 1) AND name IN ('Manchurian', 'Chinese Bhel', 'Noodles', 'Veg. Fried Rice');

-- ---- Bills: dine-in prints once, parcel twice (one for the kitchen) ----
-- pos_bill_copies is now the parcel count; dine-in has its own. Both changeable in Manage -> POS options.
INSERT INTO settings (key, value) VALUES ('pos_bill_copies_dine_in', '1'), ('pos_bill_copies', '2')
ON CONFLICT (key) DO UPDATE SET value = excluded.value;
