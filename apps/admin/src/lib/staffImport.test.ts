import { describe, expect, it } from "vitest";
import { buildRows, parseNames, parseSalaries } from "./staffImport";

describe("staff list import", () => {
  it("reads names and salaries typed on one line, with role words split off", () => {
    expect(parseSalaries("Ramu bhai 21000 Kiran 18,000 Anil dosa 19000\nbabu Waitor 16000 - Gopal: ₹9000")).toEqual([
      { name: "Ramu Bhai", role: "", salary: 21000 },
      { name: "Kiran", role: "", salary: 18000 },
      { name: "Anil", role: "Dosa", salary: 19000 },
      { name: "Babu", role: "Waiter", salary: 16000 },
      { name: "Gopal", role: "", salary: 9000 },
    ]);
  });

  it("reads a waiter list, leaving out its heading and numbering", () => {
    expect(parseNames("Waiter List:\n1. Babu\nShravan\n\nKiran kumar")).toEqual(["Babu", "Shravan", "Kiran Kumar"]);
  });

  it("matches people already on Staff by name or a common spelling, and adds waiters with no salary", () => {
    const existing = [
      { id: 1, name: "Babu", active: true, is_waiter: 1 },
      { id: 2, name: "Sarwan", active: true },
      { id: 3, name: "Kiran", active: false },
    ];
    const rows = buildRows("Babu waiter 16000 Sarvan 15000 Kiran 18000 Bhaleshwar 14000", "Babu\nKiran kumar\nBaleshwardas\nNaresh", existing);
    expect(rows).toEqual([
      { name: "Babu", role: "Waiter", salary: 16000, waiter: true, match: 1 },
      { name: "Sarvan", role: "", salary: 15000, waiter: false, match: 2 },
      // Kiran left, so a new Kiran is added, with the waiter list's fuller name.
      { name: "Kiran Kumar", role: "Waiter", salary: 18000, waiter: true, match: null },
      { name: "Baleshwardas", role: "Waiter", salary: 14000, waiter: true, match: null },
      { name: "Naresh", role: "Waiter", salary: null, waiter: true, match: null },
    ]);
  });
});
