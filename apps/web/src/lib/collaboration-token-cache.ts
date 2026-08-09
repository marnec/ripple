/**
 * Per-tab cache for collaboration tokens.
 *
 * `getCollaborationToken` is a Convex action (auth + access check + user
 * lookup) and every provider construction asks for one: each task-sheet open,
 * each document navigation, each reconnect, each presence connect. The tokens
 * are valid for minutes, so most of those calls buy nothing.
 *
 * Entries expire from the token's own `exp` claim rather than a TTL constant
 * copied from the server, so the client can never believe a token is fresher
 * than the signer does.
 */

export interface CollaborationToken {
  token: string;
  roomId: string;
}

/** Stop serving a token this long before it actually expires. */
const FRESHNESS_MARGIN_MS = 60_000;

interface CacheEntry {
  value: CollaborationToken;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CollaborationToken>>();

/**
 * Bumped by `clearCollaborationTokenCache`. A request that was already in
 * flight when the session ended resolves into a stale generation and is
 * discarded rather than written back into the cache.
 */
let generation = 0;

/**
 * Read the `exp` claim out of a signed token, or null if it isn't readable.
 * Token format is `base64url(JSON payload).base64url(signature)` — see
 * `packages/partykit/src/token-utils.ts`.
 */
function readExpiry(token: string): number | null {
  const dotIndex = token.indexOf(".");
  if (dotIndex === -1) return null;

  try {
    const base64 = token.substring(0, dotIndex).replace(/-/g, "+").replace(/_/g, "/");
    const payload: unknown = JSON.parse(atob(base64));
    if (typeof payload !== "object" || payload === null) return null;
    const exp = (payload as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp : null;
  } catch {
    return null;
  }
}

/**
 * Forget one room's token. Called when the server refuses a connection, so the
 * retry re-runs the access check instead of replaying a token just rejected.
 */
export function invalidateCollaborationToken(key: string): void {
  cache.delete(key);
}

/**
 * Forget every cached token. Called when the auth session ends: tokens carry
 * the signed-in user's identity, so one left behind would let the next user of
 * this tab connect as the previous one.
 */
export function clearCollaborationTokenCache(): void {
  cache.clear();
  inflight.clear();
  generation++;
}

export async function fetchCollaborationToken(
  key: string,
  fetcher: () => Promise<CollaborationToken>,
): Promise<CollaborationToken> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt - FRESHNESS_MARGIN_MS > Date.now()) {
    return cached.value;
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const startedAt = generation;
  const request: Promise<CollaborationToken> = fetcher()
    .then((value) => {
      const expiresAt = readExpiry(value.token);
      if (expiresAt !== null && generation === startedAt) {
        cache.set(key, { value, expiresAt });
      }
      return value;
    })
    .finally(() => {
      // Only retract our own entry — a clear (or a later caller) may have
      // replaced it with a fresh request for the same key.
      if (inflight.get(key) === request) inflight.delete(key);
    });

  inflight.set(key, request);
  return request;
}
