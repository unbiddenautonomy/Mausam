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

/* ---------- Offline queue ---------- */

interface Queued {
  path: string;
  method: string;
  json: unknown;
  at: number;
}

function readQueue(): Queued[] {
  try {
    return JSON.parse(safeGet(QUEUE_KEY) ?? "[]");
  } catch {
    return [];
  }
}
const listeners = new Set<(n: number) => void>();
function writeQueue(q: Queued[]) {
  safeSet(QUEUE_KEY, JSON.stringify(q));
  listeners.forEach((l) => l(q.length));
}
export const queueSize = () => readQueue().length;
export function onQueueChange(fn: (n: number) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** A write that survives being offline. Returns { queued: true } when saved on the phone instead. */
export async function sendOrQueue<T>(path: string, method: string, json: unknown): Promise<T | { queued: true }> {
  try {
    return await api<T>(path, { method, json });
  } catch (e) {
    if (e instanceof ApiError) throw e; // the server answered: a real error, don't queue
    writeQueue([...readQueue(), { path, method, json, at: Date.now() }]);
    return { queued: true };
  }
}

let flushing = false;
export async function flushQueue() {
  if (flushing || !token) return;
  flushing = true;
  try {
    let q = readQueue();
    while (q.length) {
      const item = q[0];
      try {
        await api(item.path, { method: item.method, json: item.json });
      } catch (e) {
        if (!(e instanceof ApiError)) break; // still offline
        // The server rejected it (e.g. day locked). Drop it so it doesn't block the rest.
        console.warn("Dropped queued entry", item, e);
      }
      q = q.slice(1);
      writeQueue(q);
    }
  } finally {
    flushing = false;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void flushQueue());
}

/* ---------- Photos ---------- */

/** Shrink a camera photo on the phone (max 1600px, JPEG) before uploading. Saves data and time. */
export async function shrinkImage(file: File, maxSide = 1600, quality = 0.8): Promise<Blob> {
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
