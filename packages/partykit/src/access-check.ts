/**
 * Periodic access re-validation, shared by the collaboration and presence
 * Durable Objects.
 *
 * Both rooms used to ask Convex about every live connection, one sequential
 * GET each, every tick. That cost scaled with open *tabs*: a user with three
 * tabs was checked three times, and a busy workspace's presence room made
 * hundreds of round-trips per tick for what is one membership question per
 * user. This module collapses the room to one subject per user and asks in
 * bounded batches.
 *
 * Transport-free on purpose (`fetch` is the only I/O) so it can be unit tested
 * without a Durable Object.
 */

export interface AccessSubject {
  userId: string;
  /** Guests carry the share they came in through; members carry nothing. */
  shareId?: string;
}

export interface AccessCheckEnv {
  CONVEX_SITE_URL?: string;
  PARTYKIT_SECRET?: string;
}

/**
 * Subjects per request. Every subject costs the backend a few document reads,
 * and one query must stay well inside Convex's read budget, so a room bigger
 * than this is asked in several requests rather than one.
 */
export const ACCESS_CHECK_BATCH_SIZE = 200;

/**
 * Collapse connection states to one subject per user, first tab wins. Guest
 * ids are unique per share visit (`guest:<nanoid>`), so keying on `userId`
 * alone is enough for guests as well.
 */
export function collectSubjects(
  states: Iterable<
    { userId?: string; shareId?: string | null } | undefined
  >,
): AccessSubject[] {
  const byUser = new Map<string, AccessSubject>();
  for (const state of states) {
    if (!state?.userId || byUser.has(state.userId)) continue;
    byUser.set(
      state.userId,
      state.shareId
        ? { userId: state.userId, shareId: state.shareId }
        : { userId: state.userId },
    );
  }
  return [...byUser.values()];
}

/**
 * Ask Convex which subjects still have access to `roomId`.
 *
 * Returns `userId → hasAccess`. A subject the backend did not answer for is
 * simply absent, and callers must treat absence as "not revoked": a failed
 * check is not a revocation. When *every* batch fails this returns `null`,
 * which callers can log once rather than per user.
 */
export async function checkRoomAccess(
  env: AccessCheckEnv,
  roomId: string,
  subjects: AccessSubject[],
): Promise<Map<string, boolean> | null> {
  const { CONVEX_SITE_URL: convexSiteUrl, PARTYKIT_SECRET: secret } = env;
  if (!convexSiteUrl || !secret || subjects.length === 0) return null;

  const access = new Map<string, boolean>();
  let answered = false;

  for (let i = 0; i < subjects.length; i += ACCESS_CHECK_BATCH_SIZE) {
    const batch = subjects.slice(i, i + ACCESS_CHECK_BATCH_SIZE);
    try {
      const response = await fetch(`${convexSiteUrl}/collaboration/check-access`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ roomId, subjects: batch }),
      });
      if (!response.ok) continue;

      const data = (await response.json()) as {
        access?: Record<string, boolean>;
      };
      for (const [userId, hasAccess] of Object.entries(data.access ?? {})) {
        if (typeof hasAccess === "boolean") access.set(userId, hasAccess);
      }
      answered = true;
    } catch (error) {
      console.error(`Access check failed for room ${roomId}:`, error);
    }
  }

  return answered ? access : null;
}
