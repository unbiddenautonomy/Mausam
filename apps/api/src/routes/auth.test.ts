import { describe, expect, it } from "vitest";
import { isLocalHost } from "./auth";

describe("isLocalHost", () => {
  it("treats a developer's computer and local network as local", () => {
    for (const u of ["http://localhost:8787/api/auth/setup", "http://127.0.0.1:8787/x", "http://[::1]:8787/x", "http://192.168.1.20:5173/x", "http://10.0.0.5/x", "http://172.20.1.1/x"]) {
      expect(isLocalHost(u)).toBe(true);
    }
  });

  it("treats any public address as online", () => {
    for (const u of ["https://mausam-admin.example.workers.dev/api/auth/setup", "https://admin.mausam.in/x", "https://172.32.0.1/x", "https://8.8.8.8/x"]) {
      expect(isLocalHost(u)).toBe(false);
    }
  });
});
