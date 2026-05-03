/**
 * HMAC-SHA256 token signing for PartyKit collaboration tokens.
 *
 * The payload carries either a workspace user identity or a guest share-link
 * identity. Guest payloads include `isGuest: true`, the granted `accessLevel`,
 * and the originating `shareId` so the partyserver can enforce per-connection
 * write-gating and periodic re-validation.
 *
 * Verification lives in `partykit/token-utils.ts` — both sides must keep the
 * payload shape and base64url encoding in sync.
 */

import type { ShareAccessLevel } from "@ripple/shared/shareTypes";

export interface TokenPayload {
  sub: string;
  name: string;
  img: string | null;
  room: string;
  exp: number;
  isGuest?: boolean;
  accessLevel?: ShareAccessLevel;
  shareId?: string;
}

function base64urlEncode(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signToken(
  payload: TokenPayload,
  secret: string,
): Promise<string> {
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = base64urlEncode(new TextEncoder().encode(payloadJson));

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signatureBytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64)),
  );

  return `${payloadB64}.${base64urlEncode(signatureBytes)}`;
}
