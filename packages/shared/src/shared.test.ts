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

import { computePay, countDays, monthDates } from "./pay";

describe("pay", () => {
  const none = { present: 0, half: 0, absent: 0, leave: 0, off: 0, unmarked: 0 };
  it("monthly pay loses 1/30 per absent day, half days count half", () => {
    const r = computePay({ pay_type: "monthly", rate: 1500000, days: { ...none, present: 26, half: 2, absent: 1, off: 1 }, advances: 200000 });
    expect(r.days_absent).toBe(2);
    expect(r.gross).toBe(1400000); // 15,000 − 2 × 500
    expect(r.net).toBe(1200000);
  });
  it("unmarked days count as worked; joining mid-month reduces monthly pay", () => {
    const r = computePay({ pay_type: "monthly", rate: 900000, days: { ...none, unmarked: 20 }, days_not_employed: 10, advances: 0 });
    expect(r.days_worked).toBe(20);
    expect(r.gross).toBe(600000);
  });
  it("daily pay is rate × days worked", () => {
    const r = computePay({ pay_type: "daily", rate: 60000, days: { ...none, present: 20, half: 1, absent: 3, unmarked: 2 }, advances: 100000, adjustment: 5000 });
    expect(r.days_worked).toBe(22.5);
    expect(r.gross).toBe(1350000);
    expect(r.net).toBe(1255000);
  });
  it("no pay set means nothing is earned", () => {
    expect(computePay({ pay_type: null, rate: null, days: none, advances: 0 }).gross).toBe(0);
  });
  it("counts days and builds month dates", () => {
    const dates = monthDates("2026-02");
    expect(dates.length).toBe(28);
    const c = countDays(dates, new Map([["2026-02-01", "present"], ["2026-02-02", "absent"]] as const));
    expect(c).toMatchObject({ present: 1, absent: 1, unmarked: 26 });
  });
});

import { findHeaderRow, guessMapping, parsePosAmount, parsePosDate } from "./pos";

describe("pos import", () => {
  it("reads Indian day-first dates in many shapes", () => {
    expect(parsePosDate("03/11/2026")).toBe("2026-11-03");
    expect(parsePosDate("3-11-26")).toBe("2026-11-03");
    expect(parsePosDate("2026-11-03")).toBe("2026-11-03");
    expect(parsePosDate("3rd Nov 2026")).toBe("2026-11-03");
    expect(parsePosDate("Nov 3, 2026")).toBe("2026-11-03");
    expect(parsePosDate(46329)).toBe("2026-11-03");
    expect(parsePosDate(new Date(Date.UTC(2026, 10, 3)))).toBe("2026-11-03");
    expect(parsePosDate("Total")).toBeNull();
  });
  it("reads rupee amounts", () => {
    expect(parsePosAmount("₹1,23,456.50")).toBe(12345650);
    expect(parsePosAmount(99.5)).toBe(9950);
    expect(parsePosAmount("(200)")).toBe(-20000);
    expect(parsePosAmount("")).toBeNull();
  });
  it("finds the header row and guesses columns", () => {
    const rows = [["Mausam Restaurant"], ["Sales report", null], ["Date", "Bills", "Cash", "UPI", "Grand Total"], ["01/11/2026", 120, 30000, 50000, 80000]];
    const h = findHeaderRow(rows);
    expect(h).toBe(2);
    const m = guessMapping(rows[h] as string[], "sales");
    expect(m).toMatchObject({ date: 0, bills: 1, cash: 2, online: 3, total: 4 });
  });
});
