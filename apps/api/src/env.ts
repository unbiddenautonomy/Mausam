import type { Role } from "@mausam/shared";

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ALLOWED_ORIGIN: string;
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
