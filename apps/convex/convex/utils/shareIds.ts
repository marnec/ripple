import { ConvexError } from "convex/values";

/**
 * Cryptographically random 22-char base64url identifier. Used both as
 * `resourceShares.shareId` (link tokens, listed in URLs) and as the
 * client-stored handle for guest invitee rows.
 *
 * 16 random bytes is more than enough for our scale: collision risk is
 * negligible even at millions of shares per workspace.
 */
export function generateShareId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const GUEST_NAME_MIN = 1;
const GUEST_NAME_MAX = 40;

/**
 * Trim + length-check a guest-supplied display name. The bounds match
 * the UI's input maxLength so a thrown error implies a bypassed
 * client-side guard.
 */
export function sanitizeGuestName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length < GUEST_NAME_MIN || trimmed.length > GUEST_NAME_MAX) {
    throw new ConvexError("Guest name must be 1-40 characters");
  }
  return trimmed;
}
