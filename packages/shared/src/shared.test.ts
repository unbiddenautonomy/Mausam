import { describe, expect, it } from "vitest";
import {
  addDays,
  businessDate,
  checkClose,
  formatINR,
  isLocked,
  monthCloseFor,
  rupeesToPaise,
  shoppingGap,
  translate,
} from "./index";

describe("money", () => {
  it("parses rupees into paise", () => {
    expect(rupeesToPaise("1,27,680")).toBe(12_768_000);
    expect(rupeesToPaise("23000.5")).toBe(2_300_050);
    expect(rupeesToPaise("₹ 380")).toBe(38_000);
    expect(rupeesToPaise("abc")).toBeNull();
    expect(rupeesToPaise("")).toBeNull();
  });
  it("formats Indian grouping", () => {
    expect(formatINR(12_768_000)).toBe("₹1,27,680");
    expect(formatINR(2_300_050)).toBe("₹23,000.50");
    expect(formatINR(-42_000)).toBe("−₹420");
    expect(formatINR(12_345_678_900)).toBe("₹12,34,56,789");
  });
});

describe("dates", () => {
  it("treats 1:30 am IST as the previous business day", () => {
    // 13 Nov 2026 01:30 IST = 12 Nov 20:00 UTC
    expect(businessDate(new Date("2026-11-12T20:00:00Z"))).toBe("2026-11-12");
    // 13 Nov 2026 06:00 IST = 13 Nov 00:30 UTC
    expect(businessDate(new Date("2026-11-13T00:30:00Z"))).toBe("2026-11-13");
  });
  it("locks a day at 11 am IST the next day", () => {
    expect(isLocked("2026-11-12", new Date("2026-11-13T05:29:00Z"))).toBe(false);
    expect(isLocked("2026-11-12", new Date("2026-11-13T05:30:00Z"))).toBe(true);
  });
  it("finds the month being closed between the 27th and the 3rd", () => {
    expect(monthCloseFor("2026-11-28")).toBe("2026-11");
    expect(monthCloseFor("2026-12-02")).toBe("2026-11");
    expect(monthCloseFor("2026-01-01")).toBe("2025-12");
    expect(monthCloseFor("2026-11-15")).toBeNull();
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("closing checks", () => {
  const memo = { total_counter: 12_768_000, cash: 2_300_000, online: 3_881_000, expenses: 6_587_000 };
  it("accepts the 12 Nov memo, which balances", () => {
    const flags = checkClose({ ...memo, memo_photo_key: "x" }, { expensesEntered: 0, tolerance: 20_000 });
    expect(flags).toEqual([]);
  });
  it("flags a formula mismatch with the difference", () => {
    const flags = checkClose({ ...memo, cash: 2_360_000, memo_photo_key: "x" }, { expensesEntered: 0, tolerance: 20_000 });
    expect(flags).toEqual([{ code: "formula_mismatch", diff: 60_000 }]);
  });
  it("flags expenses that differ from app entries beyond tolerance, and a missing photo", () => {
    const flags = checkClose(memo, { expensesEntered: 6_629_000, tolerance: 20_000 });
    expect(flags.map((f) => f.code)).toEqual(["expenses_differ", "no_memo_photo"]);
  });
  it("computes the shopping gap", () => {
    expect(shoppingGap(1_000_000, 820_000, 175_000)).toBe(5_000);
  });
});

describe("i18n", () => {
  it("fills params and falls back to English", () => {
    expect(translate("hi", "today.greeting", { name: "Nachi" })).toBe("नमस्ते, Nachi");
    expect(translate("kn", "app.name")).toBe("Mausam");
  });
});
