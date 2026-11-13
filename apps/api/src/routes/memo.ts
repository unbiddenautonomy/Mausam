import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireRole } from "../lib/auth";
import { HttpError, requireDate } from "../lib/http";
import { MemoError, memoToPaise, readMemo } from "../lib/memo";

const KEY_RE = /^\d{4}-\d{2}-\d{2}\/[a-z_]+-[0-9a-f]{16}\.(jpg|png|webp)$/;
const MEDIA = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
/** Each read costs money, so a day's memo can be read a few times at most. */
const MAX_READS_PER_DAY = 6;

export const memo = new Hono<AppEnv>();
memo.use("*", requireRole("owner", "manager"));

memo.get("/status", (c) => c.json({ available: Boolean(c.env.ANTHROPIC_API_KEY) }));

/** The latest successful read for a day, if any. */
memo.get("/:date", async (c) => {
  const date = requireDate(c.req.param("date"));
  const row = await c.env.DB.prepare(
    "SELECT id, photo_key, result, created_at FROM memo_reads WHERE business_date = ? AND status = 'ok' ORDER BY id DESC LIMIT 1",
  )
    .bind(date)
    .first<{ id: number; photo_key: string; result: string; created_at: string }>();
  return c.json({ read: row ? { ...row, result: JSON.parse(row.result) } : null });
});

memo.post("/read", async (c) => {
  const b = await c.req.json<{ business_date?: string; photo_key?: string; kind?: string }>();
  const date = requireDate(b.business_date);
  const key = b.photo_key ?? "";
  if (!KEY_RE.test(key)) throw new HttpError(422, "invalid", { field: "photo_key" });
  if (!c.env.ANTHROPIC_API_KEY) throw new HttpError(409, "memo_unavailable");

  const used = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM memo_reads WHERE business_date = ?").bind(date).first<{ n: number }>();
  if ((used?.n ?? 0) >= MAX_READS_PER_DAY) throw new HttpError(429, "too_many_reads");

  const obj = await c.env.PHOTOS.get(key);
  if (!obj) throw new HttpError(404, "not_found");
  const ext = key.split(".").pop() as keyof typeof MEDIA;
  const model = c.env.MEMO_MODEL || "claude-opus-5-5";
  const kind = b.kind === "monthly" ? "monthly" : "daily";
  const userId = c.get("user").id;

  try {
    const { read, model: servedBy } = await readMemo(c.env.ANTHROPIC_API_KEY, model, { data: await obj.arrayBuffer(), mediaType: MEDIA[ext] });
    const result = memoToPaise(read);
    const ins = await c.env.DB.prepare(
      "INSERT INTO memo_reads (business_date, kind, photo_key, model, status, result, created_by) VALUES (?, ?, ?, ?, 'ok', ?, ?)",
    )
      .bind(date, kind, key, servedBy, JSON.stringify(result), userId)
      .run();
    return c.json({ id: ins.meta.last_row_id, result });
  } catch (err) {
    const reason = err instanceof MemoError ? err.message : err instanceof Error ? err.message.slice(0, 200) : "unknown";
    console.error("memo read failed", reason);
    await c.env.DB.prepare("INSERT INTO memo_reads (business_date, kind, photo_key, model, status, error, created_by) VALUES (?, ?, ?, ?, 'failed', ?, ?)")
      .bind(date, kind, key, model, reason, userId)
      .run();
    throw new HttpError(502, "memo_failed");
  }
});
