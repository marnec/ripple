import { ConvexError } from "convex/values";

/**
 * Simple practical email regex — server-side validation only filters obvious
 * junk; real deliverability is verified by the email provider.
 */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Trim + lowercase a caller-supplied address, refusing anything that is not
 * shaped like one.
 *
 * Shared by every surface that hands an address to the mail queue. Guest
 * invitees on calendar events have been going through this since they existed;
 * workspace invites were taking a bare `v.string()` straight to Resend, so junk
 * (and header-ish strings) could be queued for delivery from the same sending
 * domain the auth OTP mail uses.
 */
export function normalizeEmail(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (!EMAIL_RE.test(t)) {
    throw new ConvexError(`Invalid email address: ${raw}`);
  }
  return t;
}
