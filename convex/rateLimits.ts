import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
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
});
