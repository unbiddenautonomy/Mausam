import { describe, expect, it } from "vitest";
import { csvRupees, periodOf, rangePeriod, toCsv, widen } from "./common";

const today = "2026-11-19";
const custom = { from: "2026-11-01", to: "2026-11-10" };

describe("report periods", () => {
  it("turns each choice into dates", () => {
    expect(rangePeriod("7", custom, today)).toEqual({ from: "2026-11-13", to: today, days: 7, q: "to=2026-11-19&days=7" });
    expect(rangePeriod("month", custom, today)).toMatchObject({ from: "2026-11-01", to: today, days: 19 });
    expect(rangePeriod("month", custom, "2026-11-01")).toMatchObject({ from: "2026-11-01", to: "2026-11-01", days: 1 });
    expect(rangePeriod("last_month", custom, today)).toMatchObject({ from: "2026-10-01", to: "2026-10-31", days: 31 });
    expect(rangePeriod("last_month", custom, "2026-03-05")).toMatchObject({ from: "2026-02-01", to: "2026-02-28", days: 28 });
    expect(rangePeriod("custom", custom, today)).toMatchObject({ from: "2026-11-01", to: "2026-11-10", days: 10 });
  });
  it("fixes picked dates that are swapped, too long or in the future", () => {
    expect(periodOf("2026-11-10", "2026-11-01", today)).toMatchObject({ from: "2026-11-01", to: "2026-11-10" });
    expect(periodOf("2026-11-10", "2026-12-25", today)).toMatchObject({ to: today, days: 10 });
    expect(periodOf("2024-01-01", "2026-11-01", today).days).toBe(366);
  });
  it("widens for running averages", () => {
    expect(widen(periodOf("2026-11-10", "2026-11-16", today), 6)).toMatchObject({ from: "2026-11-04", days: 13 });
  });
});

describe("CSV", () => {
  it("starts with a byte-order mark, quotes where needed, and writes rupees", () => {
    expect(toCsv([["Date", "Note"], ["2026-11-01", 'Tea, "special"']])).toBe('﻿Date,Note\r\n2026-11-01,"Tea, ""special"""\r\n');
    expect(csvRupees(123450)).toBe("1234.50");
    expect(csvRupees(null)).toBe("");
  });
});
