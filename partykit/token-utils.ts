/**
 * HMAC-SHA256 token verification for PartyKit (Cloudflare Worker side).
 *
 * Token format: base64url(JSON payload) + "." + base64url(HMAC-SHA256 signature)
 * Payload: { sub: userId, name: userName, img: userImage, room: roomId, exp: timestampMs }
 *
 * Signing happens in convex/collaboration.ts (Convex action).
 * Verification happens here (Cloudflare Worker).
 * Both use the shared PARTYKIT_SECRET.
 */

export interface VerifiedUser {
  userId: string;
  userName: string;
  userImage: string | null;
  roomId: string;
}

interface TokenPayload {
  sub: string;
  name: string;
  img: string | null;
  room: string;
  exp: number;
}

function base64urlDecode(str: string): Uint8Array {
  // Restore standard base64 from base64url
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padding = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  const binary = atob(base64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Verify an HMAC-signed collaboration token and extract the user payload.
 * Returns null if the token is invalid, tampered, or expired.
 */
export async function verifyToken(
  token: string,
  secret: string,
): Promise<VerifiedUser | null> {
  const dotIndex = token.indexOf(".");
  if (dotIndex === -1) return null;

  const payloadB64 = token.substring(0, dotIndex);
  const signatureB64 = token.substring(dotIndex + 1);

  try {
    // Import HMAC key
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );

    // Verify signature over the base64url-encoded payload string
    const signatureBytes = base64urlDecode(signatureB64);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(payloadB64),
    );

    if (!valid) return null;

    // Decode and parse payload
    const payloadJson = new TextDecoder().decode(base64urlDecode(payloadB64));
    const payload: TokenPayload = JSON.parse(payloadJson);

    // Check expiration
    if (payload.exp < Date.now()) return null;

    return {
      userId: payload.sub,
      userName: payload.name,
      userImage: payload.img,
      roomId: payload.room,
    };
  } catch {
    return null;
  }
}
