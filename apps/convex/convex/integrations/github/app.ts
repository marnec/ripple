/**
 * GitHub App authentication primitives.
 *
 * `signAppJwt` constructs an RS256-signed JWT used to authenticate as the
 * App itself when calling the `/app/installations/{id}/access_tokens`
 * endpoint to mint short-lived installation tokens.
 *
 * Convex actions run in a V8 isolate by default; WebCrypto's `crypto.subtle`
 * is available globally. The private key is supplied as a PKCS#8 PEM string
 * (the format the GitHub App download provides).
 */

/** Conservative TTL — GitHub allows up to 10 minutes; we use 9 to leave
 *  headroom for clock skew. */
const JWT_TTL_SECONDS = 540;

export interface SignAppJwtArgs {
  /** GitHub App id (numeric string, but JWT `iss` is a string). */
  appId: string;
  /** PKCS#8 PEM private key (the file GitHub gives you on App creation). */
  privateKeyPem: string;
  /** Optional clock injection — tests pass a fixed value. Defaults to
   *  `Date.now()`. */
  now?: () => number;
}

export async function signAppJwt(args: SignAppJwtArgs): Promise<string> {
  const nowSeconds = Math.floor((args.now?.() ?? Date.now()) / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: nowSeconds,
    exp: nowSeconds + JWT_TTL_SECONDS,
    iss: args.appId,
  };

  const encoder = new TextEncoder();
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importPkcs8PrivateKey(args.privateKeyPem);
  const sigBuf = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(signingInput),
  );
  const sigB64 = base64UrlEncode(new Uint8Array(sigBuf));

  return `${signingInput}.${sigB64}`;
}

async function importPkcs8PrivateKey(pem: string): Promise<CryptoKey> {
  const der = pemToDer(pem, "PRIVATE KEY");
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function pemToDer(pem: string, label: string): ArrayBuffer {
  const begin = `-----BEGIN ${label}-----`;
  const end = `-----END ${label}-----`;
  const beginIdx = pem.indexOf(begin);
  const endIdx = pem.indexOf(end);
  if (beginIdx < 0 || endIdx < 0) {
    throw new Error(`PEM missing ${label} markers`);
  }
  const b64 = pem
    .slice(beginIdx + begin.length, endIdx)
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
