import type { Env } from "../env";

/**
 * Photos and nightly backups live in Workers KV (the FILES binding). KV is part of Cloudflare's free plan
 * and needs no card: 1 GB of storage and 1,000 writes a day, which covers about a year of bill photos.
 * Photos expire after PHOTO_DAYS (default 400) so the free space never fills up.
 */
export interface StoredFile {
  body: ArrayBuffer;
  contentType: string;
}

const DAY = 86_400;

export async function putFile(env: Env, key: string, body: ArrayBuffer | string, contentType: string, opts: { days?: number } = {}): Promise<void> {
  const days = opts.days ?? (Math.max(30, Number(env.PHOTO_DAYS) || 400));
  await env.FILES.put(key, body, { metadata: { contentType }, expirationTtl: days * DAY });
}

export async function getFile(env: Env, key: string): Promise<StoredFile | null> {
  const { value, metadata } = await env.FILES.getWithMetadata<{ contentType?: string }>(key, "arrayBuffer");
  if (!value) return null;
  return { body: value, contentType: metadata?.contentType ?? "application/octet-stream" };
}

export async function fileExists(env: Env, key: string): Promise<boolean> {
  return (await env.FILES.get(key, "stream")) !== null;
}

/** Keys under a prefix (one page of up to 1,000 is plenty for backups). */
export async function listFiles(env: Env, prefix: string): Promise<string[]> {
  const res = await env.FILES.list({ prefix });
  return res.keys.map((k) => k.name);
}

export async function deleteFiles(env: Env, keys: string[]): Promise<void> {
  for (const k of keys) await env.FILES.delete(k);
}
