import { afterEach, describe, expect, it, vi } from "vitest";
import { api, REQUEST_TIMEOUT_MS } from "./api";

describe("api", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("gives up on a request that never answers, so syncing isn't stuck busy", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    // A fetch that only ends when it's aborted, like one left hanging after an iPad wakes from sleep.
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => new Promise((_ok, fail) => {
      init.signal?.addEventListener("abort", () => fail(new DOMException("aborted", "AbortError")));
    }));
    const call = api("/billing/orders/sync", { method: "POST", json: {} });
    const caught = call.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
    expect(await caught).toBeInstanceOf(DOMException);
  });
});
