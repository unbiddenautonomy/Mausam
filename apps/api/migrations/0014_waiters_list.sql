-- The waiters working at Mausam now. Someone already on Staff with the same name becomes a waiter; anyone missing is
-- added as a waiter. Names, IDs and commission can be changed, and waiters added or removed, in Manage -> Waiters.
UPDATE staff SET is_waiter = 1
  WHERE active = 1 AND lower(trim(name)) IN ('pintu', 'suresh', 'john', 'johnny', 'janardhan');
INSERT INTO staff (name, role, is_waiter)
  SELECT v.name, 'Waiter', 1
  FROM (SELECT 'Pintu' AS name UNION ALL SELECT 'Suresh' UNION ALL SELECT 'John' UNION ALL SELECT 'Johnny' UNION ALL SELECT 'Janardhan') v
  WHERE NOT EXISTS (SELECT 1 FROM staff s WHERE s.active = 1 AND lower(trim(s.name)) = lower(v.name));
