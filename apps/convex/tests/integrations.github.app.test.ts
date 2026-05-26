import { beforeAll, describe, expect, it } from "vitest";
import { signAppJwt } from "../convex/integrations/github/app";

/**
 * Generate a fresh RSA key pair once for the whole file. Tests then sign
 * with the private key and verify by decoding the JWT (we don't re-verify
 * the cryptographic signature — that's testing WebCrypto itself).
 */
let privateKeyPem = "";
let publicKey: CryptoKey;

beforeAll(async () => {
  const keypair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", keypair.privateKey);
  privateKeyPem = derToPem(new Uint8Array(pkcs8), "PRIVATE KEY");
  publicKey = keypair.publicKey;
});

function derToPem(der: Uint8Array, label: string): string {
  let bin = "";
  for (let i = 0; i < der.length; i++) bin += String.fromCharCode(der[i]);
  const b64 = btoa(bin);
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

function b64UrlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function parseJwt(jwt: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Uint8Array;
} {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("malformed JWT");
  const dec = (s: string) => new TextDecoder().decode(b64UrlDecode(s));
  return {
    header: JSON.parse(dec(parts[0])),
    payload: JSON.parse(dec(parts[1])),
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: b64UrlDecode(parts[2]),
  };
}

describe("integrations/github/app.signAppJwt", () => {
  it("produces a 3-part JWT (header.payload.signature)", async () => {
    const jwt = await signAppJwt({
      appId: "123",
      privateKeyPem,
    });
    expect(jwt.split(".")).toHaveLength(3);
  });

  it("header decodes to { alg: 'RS256', typ: 'JWT' }", async () => {
    const jwt = await signAppJwt({ appId: "123", privateKeyPem });
    const { header } = parseJwt(jwt);
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
  });

  it("payload claims iss=appId, iat=now (seconds), exp=iat+540", async () => {
    const fixedNowMs = 1_715_000_000_000;
    const jwt = await signAppJwt({
      appId: "424242",
      privateKeyPem,
      now: () => fixedNowMs,
    });
    const { payload } = parseJwt(jwt);
    expect(payload.iss).toBe("424242");
    expect(payload.iat).toBe(Math.floor(fixedNowMs / 1000));
    expect(payload.exp).toBe(Math.floor(fixedNowMs / 1000) + 540);
  });

  it("signature verifies against the matching public key (cryptographic correctness)", async () => {
    const jwt = await signAppJwt({ appId: "123", privateKeyPem });
    const { signingInput, signature } = parseJwt(jwt);
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      signature,
      new TextEncoder().encode(signingInput),
    );
    expect(ok).toBe(true);
  });

  it("throws a clear error when the private key PEM is malformed", async () => {
    await expect(
      signAppJwt({ appId: "123", privateKeyPem: "not a real key" }),
    ).rejects.toThrow(/PRIVATE KEY/);
  });
});
