// Money paid out of the counter for things the app records elsewhere (a staff advance, a vendor payment)
// also becomes an expense line, so the day's counter total still adds up against the memo.
import { audit } from "./db";

export async function addCounterExpense(
  db: D1Database,
  e: { date: string; categoryKey: string; amount: number; source: "advance" | "vendor_payment"; refId: number; note: string | null; userId: number },
): Promise<number> {
  const cat = await db.prepare("SELECT id FROM expense_categories WHERE key = ?").bind(e.categoryKey).first<{ id: number }>();
  const res = await db
    .prepare(
      `INSERT INTO expenses (business_date, category_id, amount, mode, has_receipt, note, created_by, source, ref_id)
       VALUES (?, ?, ?, 'cash', 0, ?, ?, ?, ?)`,
    )
    .bind(e.date, cat?.id ?? 14, e.amount, e.note, e.userId, e.source, e.refId)
    .run();
  const id = Number(res.meta.last_row_id);
  await audit(db, "expenses", id, "create", null, { ...e, id }, e.userId);
  return id;
}

export async function removeCounterExpense(db: D1Database, expenseId: number | null, userId: number): Promise<void> {
  if (!expenseId) return;
  await db.prepare("UPDATE expenses SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").bind(expenseId).run();
  await audit(db, "expenses", expenseId, "delete", { id: expenseId }, null, userId);
}
