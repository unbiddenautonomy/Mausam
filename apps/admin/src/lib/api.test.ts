import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny in-memory localStorage and a fake server, so the offline queue can run under Node.
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};
type Answer = { status: number; error?: string } | "offline";
let answers: Answer[] = [];
const sent: string[] = [];
globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
  const a = answers.shift() ?? { status: 200 };
  if (a === "offline") throw new TypeError("Failed to fetch");
  sent.push(String(url));
  const body = a.status < 400 ? { ok: true } : { error: a.error ?? "server_error" };
  return new Response(JSON.stringify(body), { status: a.status, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const { clearCopies, failedEntries, flushQueue, queueSize, retryFailed, savedCopy, saveCopy, sendOrQueue, setQueueOwner, setToken } = await import("./api");

beforeEach(() => {
  mem.clear();
  answers = [];
  sent.length = 0;
  setToken("t");
  setQueueOwner(7);
});

async function queue(path: string, json: unknown) {
  answers.push("offline");
  expect(await sendOrQueue(path, "POST", json)).toEqual({ queued: true });
}

describe("offline queue", () => {
  it("keeps an entry the server refuses, with its reason, and sends the rest", async () => {
    await queue("/expenses", { amount: 5000, business_date: "2026-11-01" });
    await queue("/expenses", { amount: 7000, business_date: "2026-11-19" });
    answers = [{ status: 409, error: "day_locked" }, { status: 201 }];
    await flushQueue();
    expect(queueSize()).toBe(0);
    expect(sent).toHaveLength(2);
    expect(failedEntries()).toEqual([expect.objectContaining({ path: "/expenses", error: "day_locked", json: { amount: 5000, business_date: "2026-11-01" } })]);
  });

  it("keeps entries queued after a server fault or a lost login, and sends them on the next try", async () => {
    await queue("/expenses", { amount: 5000 });
    answers = [{ status: 500 }];
    await flushQueue();
    expect(queueSize()).toBe(1);
    answers = [{ status: 429, error: "too_many_tries" }];
    await flushQueue();
    expect(queueSize()).toBe(1);
    expect(failedEntries()).toEqual([]);
    answers = [{ status: 201 }];
    await flushQueue();
    expect(queueSize()).toBe(0);
  });

  it("only sends entries saved by the person logged in", async () => {
    await queue("/expenses", { amount: 5000 });
    setQueueOwner(8);
    await flushQueue();
    expect(queueSize()).toBe(1);
    expect(sent).toHaveLength(0);
    setQueueOwner(7);
    await flushQueue();
    expect(queueSize()).toBe(0);
  });

  it("a refused entry can be sent again once the reason is fixed", async () => {
    await queue("/closes/2026-11-18", { total_counter: 100000 });
    answers = [{ status: 409, error: "day_locked" }];
    await flushQueue();
    const [f] = failedEntries();
    answers = [{ status: 409, error: "day_locked" }];
    await expect(retryFailed(f)).rejects.toThrow("day_locked");
    expect(failedEntries()).toHaveLength(1);
    answers = [{ status: 200 }];
    await retryFailed(f);
    expect(failedEntries()).toEqual([]);
  });
});

describe("saved copies", () => {
  it("keeps the last reply per person, and forgets them all on logout", () => {
    setQueueOwner(1);
    saveCopy("/today", { a: 1 });
    expect(savedCopy("/today")?.data).toEqual({ a: 1 });
    setQueueOwner(2);
    expect(savedCopy("/today")).toBeNull();
    setQueueOwner(1);
    clearCopies();
    expect(savedCopy("/today")).toBeNull();
  });
  it("keeps at most 40 pages, dropping the oldest", () => {
    setQueueOwner(1);
    for (let i = 0; i < 45; i++) saveCopy(`/p/${i}`, i);
    expect(savedCopy("/p/0")).toBeNull();
    expect(savedCopy("/p/44")?.data).toBe(44);
  });
});
