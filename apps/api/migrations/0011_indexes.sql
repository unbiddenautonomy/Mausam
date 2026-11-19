-- Indexes for lookups that read every row today: a shopping trip's bills, and one row's history in the audit log.
CREATE INDEX IF NOT EXISTS idx_expenses_trip ON expenses(trip_id) WHERE trip_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_row ON audit_log(table_name, row_id);
