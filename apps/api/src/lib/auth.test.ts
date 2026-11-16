import { describe, expect, it } from "vitest";
import { hashPin, verifyPin } from "./auth";

async function legacyHash(pin: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("PIN hashing", () => {
  it("verifies a new hash and rejects a wrong PIN", async () => {
    const { hash, salt } = await hashPin("4821");
    expect(hash).toMatch(/^20000\$[0-9a-f]{64}$/);
    expect(await verifyPin("4821", hash, salt)).toBe(true);
    expect(await verifyPin("4822", hash, salt)).toBe(false);
  });

  it("still accepts older plain-hex hashes made with 100,000 rounds", async () => {
    const salt = "00112233445566778899aabbccddeeff";
    const hash = await legacyHash("1234", salt);
    expect(await verifyPin("1234", hash, salt)).toBe(true);
    expect(await verifyPin("4321", hash, salt)).toBe(false);
  });

  it("rejects a tampered iteration count", async () => {
    const { hash, salt } = await hashPin("4821");
    expect(await verifyPin("4821", hash.replace(/^20000/, "1"), salt)).toBe(false);
    expect(await verifyPin("4821", hash.replace(/^20000/, "9999999"), salt)).toBe(false);
  });
});
