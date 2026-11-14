import { describe, expect, it } from "vitest";
import { billNumber, billTotals, financialYear } from "./billing";

describe("billTotals", () => {
  it("prices include GST: total is the menu price, tax is the GST part", () => {
    const t = billTotals([{ price: 22000, qty: 2, tax_rate: 500 }, { price: 500, qty: 4, tax_rate: 500 }]);
    expect(t.subtotal).toBe(46000);
    expect(t.total).toBe(46000);
    expect(t.tax).toBe(2190); // 46000 × 5/105 = 2190.47
    expect(t.cgst + t.sgst).toBe(t.tax);
    expect(t.round_off).toBe(0);
  });

  it("prices exclude GST: tax is added and the total rounded to a rupee", () => {
    const t = billTotals([{ price: 27000, qty: 1, tax_rate: 500 }, { price: 1000, qty: 3, tax_rate: 500 }], 0, false);
    expect(t.subtotal).toBe(30000);
    expect(t.tax).toBe(1500);
    expect(t.total).toBe(31500);
    const odd = billTotals([{ price: 33000, qty: 1, tax_rate: 500 }], 0, false); // 330 + 16.50
    expect(odd.total).toBe(34700);
    expect(odd.round_off).toBe(50);
  });

  it("discount is capped at the subtotal and lowers the tax", () => {
    const t = billTotals([{ price: 40000, qty: 1, tax_rate: 500 }], 4000);
    expect(t.total).toBe(36000);
    expect(t.tax).toBe(1714);
    expect(billTotals([{ price: 1000, qty: 1, tax_rate: 0 }], 99999).total).toBe(0);
  });

  it("no GST when the rate is zero", () => {
    const t = billTotals([{ price: 12345, qty: 1, tax_rate: 0 }]);
    expect(t.tax).toBe(0);
    expect(t.total).toBe(12300);
    expect(t.round_off).toBe(-45);
  });
});

describe("bill numbers", () => {
  it("uses the Indian financial year", () => {
    expect(financialYear("2026-11-14")).toBe("2627");
    expect(financialYear("2027-03-31")).toBe("2627");
    expect(financialYear("2027-04-01")).toBe("2728");
    expect(billNumber("a", "2026-11-14", 42)).toBe("A2627-00042");
  });
});
