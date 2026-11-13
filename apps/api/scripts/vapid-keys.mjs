// Prints a new key pair for push notifications. Run once: node scripts/vapid-keys.mjs
import { webcrypto as crypto } from "node:crypto";
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const b64url = (b) => Buffer.from(b).toString("base64url");
console.log("VAPID_PUBLIC_KEY  (paste into wrangler.jsonc vars):\n" + b64url(raw));
console.log("\nVAPID_PRIVATE_KEY (keep secret; paste when `npx wrangler secret put VAPID_PRIVATE_KEY` asks):\n" + jwk.d);
