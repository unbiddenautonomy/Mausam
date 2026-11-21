import { noteServerTime, noteToken, readyToResend, storage, type Bill, type Config, type RemoteOrder } from "./store";

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = storage.token();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`/api${path}`, { ...init, headers, body });
  const data = res.headers.get("Content-Type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "error");
  return data as T;
}

/**
 * Logs this screen out: the server forgets the login, so the old token can't be used again. With no internet the
 * screen still logs out (after at most 3 seconds); that login then runs out on the server by itself.
 */
export async function logout(): Promise<void> {
  if (storage.token()) {
    const wait = new Promise((done) => setTimeout(done, 3000));
    await Promise.race([api("/auth/logout", { method: "POST" }).catch(() => {}), wait]);
  }
  storage.setToken(null);
}

export async function fetchConfig(): Promise<Config> {
  const sent = Date.now();
  const c = await api<Omit<Config, "fetched_at"> & { server_time?: string }>("/billing/config");
  noteServerTime(c.server_time, sent, Date.now());
  const config = { ...c, fetched_at: new Date().toISOString() };
  storage.setConfig(config);
  return config;
}

type SyncResult = { client_id: string; status: "saved" | "duplicate" | "rejected"; error?: string };

let syncing = false;
/** Bills per request. The server saves up to 20 at a time; after a server error the batch is halved until one goes. */
const BATCH = 20;
let batchSize = BATCH;
/** Refusals that are worth trying again later: the server couldn't save the bill just then. */
const RETRY = new Set(["save_failed"]);

/** Sends unsent bills, a batch at a time. Returns how many are still waiting. */
export async function syncBills(): Promise<{ waiting: number; rejected: number }> {
  if (syncing) return count();
  syncing = true;
  try {
    for (;;) {
      const pending = storage.bills().filter((b) => !b.synced && !b.rejected).slice(0, batchSize);
      if (!pending.length) break;
      let results: SyncResult[];
      let counterTaken: boolean | undefined;
      try {
        ({ results, counter_taken: counterTaken } = await api<{ results: SyncResult[]; counter_taken?: boolean }>("/billing/bills", {
          method: "POST",
          json: { counter: storage.counter()?.code, device: storage.device(), bills: pending.map(({ synced, rejected, reported, ...b }) => b) },
        }));
        if (counterTaken) noteCounterTaken();
      } catch (e) {
        if (e instanceof ApiError && e.status >= 500) batchSize = Math.max(1, Math.floor(batchSize / 2));
        throw e;
      }
      batchSize = BATCH;
      const byId = new Map(results.map((r) => [r.client_id, r]));
      let retry = false;
      storage.setBills(
        storage.bills().map((b): Bill => {
          const r = byId.get(b.client_id);
          if (!r) return b;
          if (r.status !== "rejected") return { ...b, synced: true };
          if (RETRY.has(r.error ?? "")) {
            retry = true;
            return b;
          }
          return { ...b, rejected: r.error ?? "rejected" };
        }),
      );
      // Fewer answers than bills sent, or a bill to try again: the rest go on the next round.
      if (retry || results.length < pending.length) break;
    }
    await reportRejects();
  } finally {
    syncing = false;
  }
  return count();
}

/** The server says another device holds this screen's letter. Bills already made are kept and still sent. */
function noteCounterTaken() {
  const c = storage.counter();
  if (c && !c.taken) storage.setCounter({ ...c, taken: true });
}

/**
 * Takes a counter letter for this device. "taken" when another device holds it; "offline" when the server can't be
 * reached (the letter is then claimed with the first bills sent).
 */
export async function claimCounter(code: string): Promise<"ok" | "taken" | "offline"> {
  try {
    await api(`/billing/counters/${code}/claim`, { method: "POST", json: { device: storage.device() } });
    return "ok";
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) return "taken";
    if (e instanceof ApiError && e.status === 401) throw e;
    return "offline";
  }
}

/** Tells the server about bills it refused, so the owner sees them. Tried again on the next sync if it fails. */
async function reportRejects() {
  const list = storage.bills().filter((b) => b.rejected && !b.reported).slice(0, 20);
  if (!list.length) return;
  await api("/billing/rejects", {
    method: "POST",
    json: { rejects: list.map(({ synced, rejected, reported, ...bill }) => ({ bill, reason: rejected })) },
  });
  const done = new Set(list.map((b) => `${b.client_id}|${b.rejected}`));
  storage.setBills(storage.bills().map((b) => (done.has(`${b.client_id}|${b.rejected}`) ? { ...b, reported: true } : b)));
}

/** Sends a refused bill again (with a new number if its number was already used). */
export async function resendBill(clientId: string): Promise<{ waiting: number; rejected: number }> {
  storage.setBills(storage.bills().map((b) => (b.client_id === clientId && b.rejected ? readyToResend(b) : b)));
  return syncBills();
}

function count() {
  const bills = storage.bills();
  return { waiting: bills.filter((b) => !b.synced && !b.rejected).length, rejected: bills.filter((b) => b.rejected).length };
}

/* ---------------- Several screens: tokens and running orders ---------------- */

/** The next token number from the server, shared by every screen. Throws when offline or slow; the caller falls back. */
export async function nextToken(): Promise<number> {
  const ctl = new AbortController();
  const id = window.setTimeout(() => ctl.abort(), 3000);
  try {
    const r = await api<{ token: number }>("/billing/tokens/next", { method: "POST", json: { min: storage.counter()?.token ?? 0 }, signal: ctl.signal });
    noteToken(r.token);
    return r.token;
  } finally {
    window.clearTimeout(id);
  }
}

let syncingOrders = false;
/**
 * Sends this screen's changed and closed orders, and returns what changed on the server since this screen last
 * asked (the other screens' changes). The caller merges them in with mergeRemote().
 */
export async function syncOrders(): Promise<RemoteOrder[]> {
  if (syncingOrders) return [];
  syncingOrders = true;
  try {
    const pushed = storage.pushed();
    const changed = storage.orders().filter((o) => o.updated_at && pushed[o.id] !== o.updated_at).slice(0, 80);
    const closed = storage.closed().slice(0, 20);
    const r = await api<{ cursor: number; token_last: number; orders: RemoteOrder[] }>("/billing/orders/sync", {
      method: "POST",
      json: {
        counter: storage.counter()?.code,
        since: storage.cursor(),
        last_token: storage.counter()?.token ?? 0,
        orders: [
          ...changed.map((o) => ({ id: o.id, updated_at: o.updated_at, closed: false, data: o })),
          ...closed.map((c) => ({ id: c.id, updated_at: c.updated_at, closed: true })),
        ],
      },
    });
    noteToken(r.token_last);
    storage.setCursor(r.cursor);
    // The server has these now.
    const sentClosed = new Set(closed.map((c) => `${c.id}|${c.updated_at}`));
    storage.setClosed(storage.closed().filter((c) => !sentClosed.has(`${c.id}|${c.updated_at}`)));
    const p = storage.pushed();
    for (const o of changed) p[o.id] = o.updated_at!;
    storage.setPushed(p);
    return r.orders;
  } finally {
    syncingOrders = false;
  }
}

/** Every bill of the day from all screens, as saved on the server. */
export async function fetchDay(date: string): Promise<Bill[]> {
  const r = await api<{ bills: Omit<Bill, "synced">[] }>(`/billing/day?date=${date}`);
  return r.bills.map((b) => ({ ...b, synced: true }));
}

/** Bills from a date to a date (owner and managers), for the Report's menu. */
export async function fetchRange(from: string, to: string): Promise<Bill[]> {
  const r = await api<{ bills: Omit<Bill, "synced">[] }>(`/billing/range?from=${from}&to=${to}`);
  return r.bills.map((b) => ({ ...b, synced: true }));
}
