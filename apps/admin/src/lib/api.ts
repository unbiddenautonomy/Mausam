// Small fetch wrapper: adds the login token, turns errors into ApiError,
// and keeps "queueable" writes on the phone when offline, sending them later.

const TOKEN_KEY = "mausam.token";
const QUEUE_KEY = "mausam.queue";

export class ApiError extends Error {
  constructor(public status: number, public code: string, public detail?: any) {
    super(code);
  }
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the app still works for this session */
  }
}

let token: string | null = safeGet(TOKEN_KEY);
export const getToken = () => token;
export function setToken(t: string | null) {
  token = t;
  safeSet(TOKEN_KEY, t);
}

let onUnauthorised: () => void = () => {};
export const setUnauthorisedHandler = (fn: () => void) => (onUnauthorised = fn);

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`/api${path}`, { ...init, headers, body });
  if (res.status === 401 && token && !path.startsWith("/auth/login")) {
    setToken(null);
    onUnauthorised();
  }
  const data = res.headers.get("Content-Type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "server_error", data?.detail);
  return data as T;
}

/* ---------- Saved copies of pages, for opening them offline ---------- */

const CACHE_PREFIX = "mausam.cache.";
const CACHE_INDEX = "mausam.cache.index";
const CACHE_MAX_ENTRIES = 40;
const CACHE_MAX_CHARS = 150_000;

/** The last good reply to a GET, kept per person so a shared phone doesn't show one person's data to another. */
export function saveCopy(path: string, data: unknown): void {
  if (owner === null) return;
  const key = `${CACHE_PREFIX}${owner}:${path}`;
  const text = JSON.stringify({ at: Date.now(), data });
  if (text.length > CACHE_MAX_CHARS) return;
  safeSet(key, text);
  const index = readList<string>(CACHE_INDEX).filter((k) => k !== key);
  index.push(key);
  while (index.length > CACHE_MAX_ENTRIES) safeSet(index.shift()!, null);
  safeSet(CACHE_INDEX, JSON.stringify(index));
}

export function savedCopy<T>(path: string): { at: number; data: T } | null {
  if (owner === null) return null;
  try {
    const v = JSON.parse(safeGet(`${CACHE_PREFIX}${owner}:${path}`) ?? "null");
    return v && typeof v.at === "number" ? v : null;
  } catch {
    return null;
  }
}

/** Forgets every saved copy (on logging out). */
export function clearCopies(): void {
  for (const k of readList<string>(CACHE_INDEX)) safeSet(k, null);
  safeSet(CACHE_INDEX, null);
}

/* ---------- Offline queue ---------- */

const FAILED_KEY = "mausam.queue.failed";

export interface Queued {
  path: string;
  method: string;
  json: unknown;
  at: number;
  /** Who saved it. Only that person's login sends it, so a shared phone doesn't send one person's entry as another's. */
  user?: number | null;
}
/** An entry the server refused. It stays on the phone until someone sends it again or deletes it. */
export interface Failed extends Queued {
  error: string;
  failed_at: number;
}

function readList<T>(key: string): T[] {
  try {
    const v = JSON.parse(safeGet(key) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
const readQueue = () => readList<Queued>(QUEUE_KEY);
export const failedEntries = () => readList<Failed>(FAILED_KEY);

const listeners = new Set<(n: number, failed: number) => void>();
function changed() {
  const q = readQueue().length;
  const f = failedEntries().length;
  listeners.forEach((l) => l(q, f));
}
function writeQueue(q: Queued[]) {
  safeSet(QUEUE_KEY, JSON.stringify(q));
  changed();
}
function writeFailed(f: Failed[]) {
  safeSet(FAILED_KEY, f.length ? JSON.stringify(f) : null);
  changed();
}
export const queueSize = () => readQueue().length;
export function onQueueChange(fn: (n: number, failed: number) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let owner: number | null = null;
/** The logged-in person. Set by the session; entries saved offline are marked with it. */
export function setQueueOwner(id: number | null) {
  owner = id;
}

/** A write that survives being offline. Returns { queued: true } when saved on the phone instead. */
export async function sendOrQueue<T>(path: string, method: string, json: unknown): Promise<T | { queued: true }> {
  try {
    return await api<T>(path, { method, json });
  } catch (e) {
    if (e instanceof ApiError) throw e; // the server answered: a real error, don't queue
    // `at` also tells entries apart, so two saved in the same millisecond get different ones (otherwise sending
    // the first removed both from the queue, and the second was never sent).
    const q = readQueue();
    const at = Math.max(Date.now(), ...q.map((x) => x.at + 1));
    writeQueue([...q, { path, method, json, at, user: owner }]);
    return { queued: true };
  }
}

/** Worth trying again later without anyone doing anything: logged out, too many requests, or a server fault. */
const tryLater = (e: ApiError) => e.status === 401 || e.status === 429 || e.status >= 500;

let flushing = false;
/**
 * Sends what was saved offline, oldest first. Stops at the first entry that can't go yet (still offline, logged out,
 * or a server fault) and keeps it. An entry the server refuses (for example a locked day) moves to the "not sent"
 * list with its reason, so nothing is lost without the person seeing it.
 */
export async function flushQueue() {
  if (flushing || !token) return;
  flushing = true;
  try {
    for (;;) {
      const q = readQueue();
      const i = q.findIndex((item) => item.user == null || item.user === owner);
      if (i === -1) break;
      const item = q[i];
      try {
        await api(item.path, { method: item.method, json: item.json });
      } catch (e) {
        if (!(e instanceof ApiError) || tryLater(e)) break;
        writeFailed([...failedEntries(), { ...item, error: e.code, failed_at: Date.now() }]);
      }
      writeQueue(readQueue().filter((x) => !(x.at === item.at && x.path === item.path)));
    }
  } finally {
    flushing = false;
  }
}

/** Tries a refused entry again. Throws the server's answer if it's refused again; the entry then stays in the list. */
export async function retryFailed(item: Failed): Promise<void> {
  await api(item.path, { method: item.method, json: item.json });
  dropFailed(item);
}
export function dropFailed(item: Failed) {
  writeFailed(failedEntries().filter((x) => !(x.at === item.at && x.path === item.path)));
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void flushQueue());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flushQueue();
  });
  // The phone doesn't always say when the internet is back, so try again every minute while entries wait.
  window.setInterval(() => {
    if (queueSize() > 0) void flushQueue();
  }, 60_000);
}

/* ---------- Photos ---------- */

/** Shrink a camera photo on the phone (max 1600px, JPEG) before uploading. Saves data and time. */
export async function shrinkImage(file: File, maxSide = 1600, quality = 0.75): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", quality));
}

export async function uploadPhoto(file: File, kind: string): Promise<string> {
  const blob = await shrinkImage(file);
  const res = await api<{ key: string }>(`/photos?kind=${kind}`, {
    method: "POST",
    headers: { "Content-Type": blob.type || "image/jpeg" },
    body: blob,
  });
  return res.key;
}

export const photoUrl = (key: string) => `/api/photos/${key}`;

/**
 * Photos need the login token, which an <img src> can't send. Fetch them with the token and hand back a
 * local object URL instead. Results are kept for the session so lists don't download twice.
 */
const photoCache = new Map<string, Promise<string>>();
export function loadPhoto(key: string): Promise<string> {
  let p = photoCache.get(key);
  if (!p) {
    p = fetch(photoUrl(key), { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(async (res) => {
      if (!res.ok) throw new ApiError(res.status, "photo_failed");
      return URL.createObjectURL(await res.blob());
    });
    p.catch(() => photoCache.delete(key));
    photoCache.set(key, p);
  }
  return p;
}
