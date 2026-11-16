import { describe, expect, it } from "vitest";
import { findDate, lastAmount, parseMemoText } from "./memoText";

const L = (...texts: string[]) => texts.map((text) => ({ text, confidence: 90 }));

describe("lastAmount", () => {
  it("reads common ways of writing rupees", () => {
    expect(lastAmount("Milk 1,250")?.paise).toBe(125_000);
    expect(lastAmount("Gas Rs.1200/-")?.paise).toBe(120_000);
    expect(lastAmount("Tea ₹45.50")?.paise).toBe(4_550);
    expect(lastAmount("ಹಾಲು ೫೦೦")?.paise).toBe(50_000);
    expect(lastAmount("दूध ५००")?.paise).toBe(50_000);
  });
  it("fixes letters that look like digits, and says so", () => {
    expect(lastAmount("Cash 12OO")).toMatchObject({ paise: 120_000, fixed: true });
    expect(lastAmount("Milk 3oo")).toMatchObject({ paise: 30_000, fixed: true });
  });
  it("leaves words and codes alone", () => {
    expect(lastAmount("Oil")).toBeNull();
    expect(lastAmount("Bill A2627")).toBeNull();
    expect(lastAmount("2nd shift")).toBeNull();
  });
});

describe("findDate", () => {
  it("reads day-first dates", () => {
    expect(findDate("Date 14/11/2026")).toBe("2026-11-14");
    expect(findDate("4-1-26")).toBe("2026-01-04");
    expect(findDate("ದಿನಾಂಕ ೧೪.೧೧.೨೦೨೬")).toBe("2026-11-14");
    expect(findDate("32/13/2026")).toBeNull();
  });
});

describe("parseMemoText", () => {
  it("reads a typical memo", () => {
    const r = parseMemoText(
      L("MAUSAM", "Date 14/11/26", "Total sale 23,600", "Cash 12,000", "Online 7,000", "Milk 1,200", "Vegetables 2,400", "Gas 1,000", "Exp total 4,600"),
    );
    expect(r).toMatchObject({ date: "2026-11-14", total: 2_360_000, cash: 1_200_000, online: 700_000, expenses_total: 460_000, unsure: [] });
    expect(r.lines).toEqual([
      { label: "Milk", amount: 120_000 },
      { label: "Vegetables", amount: 240_000 },
      { label: "Gas", amount: 100_000 },
    ]);
  });
  it("reads Kannada and Hindi words", () => {
    const r = parseMemoText(L("ಒಟ್ಟು 10000", "ನಗದು 6000", "ಆನ್‌ಲೈನ್ 3000", "ಖರ್ಚು 1000"));
    expect(r).toMatchObject({ total: 1_000_000, cash: 600_000, online: 300_000, expenses_total: 100_000, unsure: [] });
    const h = parseMemoText(L("कुल 10000", "नकद 6000", "ऑनलाइन 3000", "खर्च 1000"));
    expect(h).toMatchObject({ total: 1_000_000, cash: 600_000, online: 300_000, expenses_total: 100_000 });
  });
  it("adds separate UPI and card lines into online, marked unsure", () => {
    const r = parseMemoText(L("GPay 4000", "PhonePe 2500", "Card 500"));
    expect(r.online).toBe(700_000);
    expect(r.unsure).toContain("online");
  });
  it("marks numbers unsure when the sum doesn't hold or OCR was unsure", () => {
    const r = parseMemoText(L("Total 10000", "Cash 6000", "Online 3000", "Exp 900"));
    expect(r.unsure).toEqual(["total", "cash", "online", "expenses_total"]);
    const low = parseMemoText([{ text: "Cash 6000", confidence: 40 }]);
    expect(low.unsure).toEqual(["cash"]);
  });
  it("doesn't calculate what isn't written", () => {
    const r = parseMemoText(L("Cash 6000", "Online 3000"));
    expect(r.total).toBeNull();
    expect(r.expenses_total).toBeNull();
  });
});
