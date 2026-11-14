import { storage, type Bill, type Config } from "./store";

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

export async function fetchConfig(): Promise<Config> {
  const c = await api<Omit<Config, "fetched_at">>("/billing/config");
  const config = { ...c, fetched_at: new Date().toISOString() };
  storage.setConfig(config);
  return config;
}

type SyncResult = { client_id: string; status: "saved" | "duplicate" | "rejected"; error?: string };

let syncing = false;
/** Sends unsent bills, 50 at a time. Returns how many are still waiting. */
export async function syncBills(): Promise<{ waiting: number; rejected: number }> {
  if (syncing) return count();
  syncing = true;
  try {
    for (;;) {
      const pending = storage.bills().filter((b) => !b.synced && !b.rejected).slice(0, 50);
      if (!pending.length) break;
      const { results } = await api<{ results: SyncResult[] }>("/billing/bills", {
        method: "POST",
        json: { counter: storage.counter()?.code, bills: pending.map(({ synced, rejected, ...b }) => b) },
      });
      const byId = new Map(results.map((r) => [r.client_id, r]));
      storage.setBills(
        storage.bills().map((b): Bill => {
          const r = byId.get(b.client_id);
          if (!r) return b;
          return r.status === "rejected" ? { ...b, rejected: r.error ?? "rejected" } : { ...b, synced: true };
        }),
      );
      if (results.length < pending.length) break;
    }
  } finally {
    syncing = false;
  }
  return count();
}

function count() {
  const bills = storage.bills();
  return { waiting: bills.filter((b) => !b.synced && !b.rejected).length, rejected: bills.filter((b) => b.rejected).length };
}
