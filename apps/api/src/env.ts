import type { Role } from "@mausam/shared";

export interface Env {
  DB: D1Database;
  FILES: KVNamespace; // photos and nightly backups (see lib/files.ts)
  ALLOWED_ORIGIN: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string; // optional; otherwise keys are made and kept in settings
  VAPID_SUBJECT?: string;
  ANTHROPIC_API_KEY?: string; // secret: for reading handwritten memos
  MEMO_MODEL?: string;
  SETUP_CODE?: string; // secret: if set, creating the first owner account needs this code
  BACKUP_DAYS?: string; // how many nightly backups to keep (default 35)
  PHOTO_DAYS?: string; // how long photos are kept (default 400 days)
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
