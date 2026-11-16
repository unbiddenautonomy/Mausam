import type { MiddlewareHandler } from "hono";
import type { Role } from "@mausam/shared";
import type { AppEnv, AuthUser } from "../env";
import { HttpError } from "./http";

// PIN hashing cost. A 4-digit PIN is protected by the account lock and login rate limit, not by hashing cost,
// so this is kept light enough for the free Workers plan's 10 ms CPU limit per request (100,000 took ~15 ms).
// New hashes are stored as "<iterations>$<hex>"; older plain-hex hashes were made with 100,000.
const ITERATIONS = 20_000;
const LEGACY_ITERATIONS = 100_000;
const SESSION_DAYS = 60;

function toHex(buf: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function randomHex(bytes: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function derive(pin: string, saltHex: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex), iterations },
    key,
    256,
  );
  return toHex(bits);
}

export async function hashPin(pin: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ?? randomHex(16);
  return { hash: `${ITERATIONS}$${await derive(pin, salt, ITERATIONS)}`, salt };
}

export async function verifyPin(pin: string, stored: string, salt: string): Promise<boolean> {
  const sep = stored.indexOf("$");
  const iterations = sep === -1 ? LEGACY_ITERATIONS : Number(stored.slice(0, sep));
  const hash = sep === -1 ? stored : stored.slice(sep + 1);
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > LEGACY_ITERATIONS) return false;
  const candidate = await derive(pin, salt, iterations);
  if (candidate.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

export function validPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{4}$/.test(pin);
}

/** Keep the last 10 digits so "+91 98450 12345" and "9845012345" match. */
export function normalisePhone(phone: unknown): string | null {
  if (typeof phone !== "string") return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

export async function createSession(db: D1Database, userId: number): Promise<string> {
  const token = randomHex(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  await db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").bind(token, userId, expires).run();
  return token;
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HttpError(401, "not_logged_in");
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.phone, u.role, u.language FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`,
  )
    .bind(token, new Date().toISOString())
    .first<AuthUser>();
  if (!row) throw new HttpError(401, "not_logged_in");
  c.set("user", row);
  await next();
};

export function requireRole(...roles: Role[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!roles.includes(c.get("user").role)) throw new HttpError(403, "not_allowed");
    await next();
  };
}
