import { Hono } from "hono";
import { businessDate } from "@mausam/shared";
import type { AppEnv } from "../env";
import { randomHex, requireRole } from "../lib/auth";
import { HttpError } from "../lib/http";

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export const photos = new Hono<AppEnv>();

/** Upload one photo (the app shrinks it on the phone first). Returns the key to attach to an entry. */
photos.post("/", requireRole("owner", "manager"), async (c) => {
  const type = (c.req.header("Content-Type") ?? "").split(";")[0].trim();
  const ext = TYPES[type];
  if (!ext) throw new HttpError(422, "invalid", { field: "content_type" });
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) throw new HttpError(422, "invalid", { field: "file" });
  if (body.byteLength > MAX_BYTES) throw new HttpError(413, "too_large");
  const kind = (c.req.query("kind") ?? "receipt").replace(/[^a-z_]/g, "").slice(0, 20) || "receipt";
  const key = `${businessDate()}/${kind}-${randomHex(8)}.${ext}`;
  await c.env.PHOTOS.put(key, body, {
    httpMetadata: { contentType: type },
    customMetadata: { uploaded_by: String(c.get("user").id) },
  });
  return c.json({ key }, 201);
});

photos.get("/*", requireRole("owner", "manager"), async (c) => {
  const key = c.req.path.replace(/^\/api\/photos\//, "");
  if (!/^\d{4}-\d{2}-\d{2}\/[a-z_]+-[0-9a-f]{16}\.(jpg|png|webp)$/.test(key)) throw new HttpError(404, "not_found");
  const obj = await c.env.PHOTOS.get(key);
  if (!obj) throw new HttpError(404, "not_found");
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "image/jpeg",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
});
