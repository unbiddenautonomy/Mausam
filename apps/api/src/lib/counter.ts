// Money paid out of the counter for things the app records elsewhere (a staff advance, a vendor payment)
// also becomes an expense line, so the day's counter total still adds up against the memo.
import { audit } from "./db";

/**
 * The statements that add the counter expense for a row just inserted (an advance or a vendor payment) and link the
 * row to it. They go in the same db.batch, right after that row's INSERT, so all of it is saved or none.
 * They rely on last_insert_rowid(): first the row's id (the expense's ref_id), then the expense's id.
 */
export function counterExpenseStmts(
  db: D1Database,
  table: "advances" | "vendor_payments",
  e: { date: string; categoryKey: string; amount: number; source: "advance" | "vendor_payment"; note: string | null; userId: number },
): D1PreparedStatement[] {
  return [
    db.prepare(
      `INSERT INTO expenses (business_date, category_id, amount, mode, has_receipt, note, created_by, source, ref_id)
       VALUES (?, COALESCE((SELECT id FROM expense_categories WHERE key = ?), 14), ?, 'cash', 0, ?, ?, ?, last_insert_rowid())`,
    ).bind(e.date, e.categoryKey, e.amount, e.note, e.userId, e.source),
    db.prepare(`UPDATE ${table} SET expense_id = last_insert_rowid() WHERE id = (SELECT ref_id FROM expenses WHERE id = last_insert_rowid())`),
  ];
}

export async function removeCounterExpense(db: D1Database, expenseId: number | null, userId: number): Promise<void> {
  if (!expenseId) return;
  await db.prepare("UPDATE expenses SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").bind(expenseId).run();
  await audit(db, "expenses", expenseId, "delete", { id: expenseId }, null, userId);
}
