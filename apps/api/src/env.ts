import type { Role } from "@mausam/shared";

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ALLOWED_ORIGIN: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string; // secret: set with `wrangler secret put VAPID_PRIVATE_KEY`
  VAPID_SUBJECT?: string;
  ANTHROPIC_API_KEY?: string; // secret: for reading handwritten memos
  MEMO_MODEL?: string;
  SETUP_CODE?: string; // secret: if set, creating the first owner account needs this code
  BACKUP_DAYS?: string; // how many nightly backups to keep in R2 (default 35)
  LOGIN_LIMITER?: RateLimit; // Workers rate limiting bindings (optional; see wrangler.jsonc)
  API_LIMITER?: RateLimit;
}

export interface AuthUser {
  id: number;
  name: string;
  phone: string;
  role: Role;
  language: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: AuthUser };
};
