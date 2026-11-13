import { describe, expect, it } from "vitest";
import { createECDH, createPublicKey, verify } from "node:crypto";
// Independent reference implementation of RFC 8188/8291, used only to check our encryption.
// @ts-expect-error no types
import ece from "http_ece";
import { b64urlDecode, b64urlEncode, encryptPayload, generateVapidKeys, vapidAuthorization } from "./webpush";

describe("web push encryption", () => {
  it("produces a body the browser side can decrypt", async () => {
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const message = JSON.stringify({ title: "Closing pending", body: "Close the day", badge: 2 });
    const body = await encryptPayload(
      { p256dh: b64urlEncode(new Uint8Array(ua.getPublicKey())), auth: b64urlEncode(auth) },
      new TextEncoder().encode(message),
    );
    const plain = ece.decrypt(Buffer.from(body), { version: "aes128gcm", privateKey: ua, authSecret: Buffer.from(auth) });
    expect(plain.toString("utf8")).toBe(message);
  });
});

describe("VAPID", () => {
  it("signs a JWT the push service can verify with the public key", async () => {
    const keys = await generateVapidKeys();
    const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", { ...keys, subject: "mailto:owner@example.com" });
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(m).toBeTruthy();
    const claims = JSON.parse(Buffer.from(b64urlDecode(m[2])).toString());
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    expect(m[4]).toBe(keys.publicKey);
    const pub = b64urlDecode(keys.publicKey);
    const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33)) }, format: "jwk" });
    const ok = verify("sha256", Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(b64urlDecode(m[3])));
    expect(ok).toBe(true);
  });
});
