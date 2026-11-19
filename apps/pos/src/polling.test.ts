import { describe, expect, it } from "vitest";
import { BUSY_EVERY_MS, IDLE_EVERY_MS, ordersDelay } from "./polling";

const CONFIG_CHECKS_AN_HOUR = 6;

describe("order checks", () => {
  it("are quick while the screen is in use and slow when idle", () => {
    const now = 1_000_000_000;
    expect(ordersDelay(now - 10_000, now)).toBe(BUSY_EVERY_MS);
    expect(ordersDelay(now - 3 * 60_000, now)).toBe(IDLE_EVERY_MS);
  });
  it("keep an idle screen under 200 requests an hour", () => {
    // Order checks, plus the menu every 10 minutes. Bill sync sends nothing when no bill is waiting.
    expect(3_600_000 / IDLE_EVERY_MS + CONFIG_CHECKS_AN_HOUR).toBeLessThan(200);
  });
});
