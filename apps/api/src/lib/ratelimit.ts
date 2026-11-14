import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { HttpError } from "./http";

/**
 * Uses a Cloudflare Workers rate limiting binding when it's configured (wrangler.jsonc → "ratelimits").
 * Without the binding, requests pass through, so local development and tests need nothing extra.
 */
export function rateLimit(binding: "LOGIN_LIMITER" | "API_LIMITER", by: "ip" | "user"): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const limiter = c.env[binding];
    if (limiter) {
      const key = by === "user" ? `u:${c.get("user")?.id ?? "anon"}` : `ip:${c.req.header("CF-Connecting-IP") ?? "unknown"}`;
      const { success } = await limiter.limit({ key });
      if (!success) throw new HttpError(429, "too_many_tries");
    }
    await next();
  };
}
