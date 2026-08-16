import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";

/**
 * App-wide rate limits. Centralised so every caller uses identical names
 * and the rates live in one place.
 *
 * Strategies:
 * - token bucket: steady refill + burst allowance
 * - fixed window: hard ceiling per period
 *
 * Key conventions:
 * - `guestShare*` limits are keyed by `shareId` (per-link bucket). Abuse of
 *   one link can't starve another guest on a different link.
 * - `guestShareWorkspace*` limits are keyed by `workspaceId` — second-layer
 *   cap so an attacker that rotates through many share links still hits a
 *   per-workspace ceiling.
 */
export const rateLimiter = new RateLimiter(components.rateLimiter, {
  // Per-share-link: guest collaboration token refresh.
  // Legit use: token expires every 5 min; heavy tabs/reconnects bump this.
  // 30/min with burst of 10 tolerates ~20 simultaneous guests on one link.
  guestShareCollabToken: {
    kind: "token bucket",
    rate: 30,
    period: MINUTE,
    capacity: 10,
  },

  // Per-share-link: guest call token issuance.
  // Each call hits Cloudflare RTK participant API (quota-burning).
  // Tighter: 10/min with burst of 5 tolerates normal join/reconnect bursts
  // but chokes spam.
  guestShareCallToken: {
    kind: "token bucket",
    rate: 10,
    period: MINUTE,
    capacity: 5,
  },

  // Per-workspace aggregate ceiling for collab tokens.
  // Bypasses per-link key rotation. Sharded for throughput.
  guestShareCollabTokenWorkspace: {
    kind: "token bucket",
    rate: 120,
    period: MINUTE,
    capacity: 60,
    shards: 4,
  },

  // Per-workspace aggregate ceiling for call tokens.
  guestShareCallTokenWorkspace: {
    kind: "token bucket",
    rate: 40,
    period: MINUTE,
    capacity: 20,
    shards: 4,
  },

  // ── Workspace invites ───────────────────────────────────────────────
  // Signup is open and `workspaces.create` makes the caller an admin, so
  // "admin of a workspace" is not a scarce credential: any account can mint a
  // workspace, invite a third party, and loop. Every send is real Resend mail
  // from the same domain the auth OTP/password-reset mail uses, so the cost of
  // abuse is not quota — it is the deliverability of sign-in email.
  //
  // Fixed window rather than token bucket: there is no legitimate burst here.
  // A human inviting a team types addresses one at a time.

  // Per-invite: the resend button on ONE pending invite. Covers the actual
  // amplifier — `create` already refuses a duplicate PENDING invite for the
  // same (workspace, email), so the unbounded loop was always `resend`.
  // 3/hour is well above "they didn't get it, try again" and far below spam.
  workspaceInviteResend: {
    kind: "fixed window",
    rate: 3,
    period: HOUR,
  },

  // Per-workspace: new invites. Second layer, because rotating addresses
  // rotates the per-invite key. 20/hour covers onboarding a team in one
  // sitting; a workspace that legitimately needs more can send again next hour.
  workspaceInviteCreate: {
    kind: "fixed window",
    rate: 20,
    period: HOUR,
  },
});
