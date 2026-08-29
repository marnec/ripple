/**
 * Per-connection presence bookkeeping for the workspace presence room.
 *
 * Presence is reported *per user* on the wire, but a user may hold several
 * connections at once (one per open tab). Keeping a single entry per userId
 * makes those tabs race: the last `presence_update` wins, and closing the tab
 * that happened to write last leaves the user pinned to a page they are no
 * longer on until some other tab navigates.
 *
 * So the registry stores one record per *connection* and derives the per-user
 * entry on read: the most recently updated connection of that user wins. That
 * is the closest available proxy for "the tab the user is actually looking at"
 * — navigating implies focus — and it self-corrects on close, because the
 * winner is recomputed from the connections that remain.
 *
 * Pure and transport-free so it can be unit tested without a Durable Object.
 */

export interface PresenceIdentity {
  userId: string;
  userName: string;
  userImage: string | null;
}

export interface PresenceLocation {
  currentPath: string;
  resourceType?: string;
  resourceId?: string;
  /**
   * Channel whose call this *connection* is joined to, if any.
   *
   * Unlike the rest of the location, this is not derived from the winning
   * connection — see `callFor`.
   */
  callChannelId?: string;
  /**
   * Whether that call is being transcribed. Travels with `callChannelId` and
   * is only ever read together with it. `undefined` means unknown, not off.
   */
  callTranscribing?: boolean;
}

export type PresenceEntry = PresenceIdentity & PresenceLocation;

/**
 * What the caller should broadcast after a connection closes.
 * `null` means "nothing visibly changed" — either the closed connection was
 * not the one representing this user, or no remaining connection has reported
 * a location yet (its first update, sent on open, will follow in milliseconds).
 */
export type PresenceRemoval =
  | { kind: "left"; userId: string }
  | { kind: "changed"; entry: PresenceEntry }
  | null;

interface ConnectionRecord {
  identity: PresenceIdentity;
  location: PresenceLocation | null;
  /** Monotonic write order; highest wins when deriving the user's entry. */
  seq: number;
}

export class PresenceRegistry {
  private connections = new Map<string, ConnectionRecord>();
  private byUser = new Map<string, Set<string>>();
  private seq = 0;

  /**
   * Register an authenticated connection. It contributes to the user's
   * liveness immediately but does not appear in the snapshot until it reports
   * a location.
   */
  add(connectionId: string, identity: PresenceIdentity): void {
    this.connections.set(connectionId, { identity, location: null, seq: 0 });
    const conns = this.byUser.get(identity.userId) ?? new Set<string>();
    conns.add(connectionId);
    this.byUser.set(identity.userId, conns);
  }

  /**
   * Record a location for a connection. Returns the user's derived entry — its
   * location is always this connection's, since it just became the most recent
   * writer — or null if the connection is unknown (closed mid-flight).
   */
  update(connectionId: string, location: PresenceLocation): PresenceEntry | null {
    const record = this.connections.get(connectionId);
    if (!record) return null;

    record.location = location;
    record.seq = ++this.seq;

    // Via `entryFor` rather than this record alone: `callChannelId` is unioned
    // across the user's tabs, so a browsing tab's update must not report the
    // user as having left the call their other tab is still in.
    return this.entryFor(record.identity.userId);
  }

  /**
   * Drop a connection and report what changed for its user.
   */
  remove(connectionId: string): PresenceRemoval {
    const record = this.connections.get(connectionId);
    if (!record) return null;

    const { userId } = record.identity;
    const winnerBefore = this.winningConnectionId(userId);

    this.connections.delete(connectionId);
    const conns = this.byUser.get(userId);
    conns?.delete(connectionId);

    if (!conns || conns.size === 0) {
      this.byUser.delete(userId);
      return { kind: "left", userId };
    }

    // Some tab is still open, so the user has not left. Re-derive their entry:
    // it only moves if the connection we just dropped was the one representing
    // them.
    if (winnerBefore !== connectionId) return null;

    const entry = this.entryFor(userId);
    return entry ? { kind: "changed", entry } : null;
  }

  /** One entry per user that has reported a location. */
  snapshot(): PresenceEntry[] {
    const entries: PresenceEntry[] = [];
    for (const userId of this.byUser.keys()) {
      const entry = this.entryFor(userId);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  /** The derived entry for a user, or null if none of their tabs reported yet. */
  entryFor(userId: string): PresenceEntry | null {
    const connectionId = this.winningConnectionId(userId);
    if (!connectionId) return null;
    const record = this.connections.get(connectionId);
    if (!record?.location) return null;
    return {
      ...record.identity,
      ...record.location,
      ...this.callFor(userId),
    };
  }

  /**
   * The call this user is in, across *all* their connections.
   *
   * Location is "the tab you are looking at", so it comes from the most recent
   * writer. Call membership is not: a user with the call in one tab and the
   * board open in another is still in the call, and taking the winner's value
   * would drop them from the indicator the moment they switched tabs. A user
   * can only hold one call at a time (joining elsewhere leaves the first), so
   * any connection reporting one is authoritative.
   *
   * Returns the channel and its transcription mode as a *pair*, read off the
   * same connection. Sourcing them independently could pair one tab's channel
   * with another tab's mode — which for a control whose whole job is to say
   * whether you are being recorded is the one error worth designing out.
   */
  private callFor(userId: string): {
    callChannelId?: string;
    callTranscribing?: boolean;
  } {
    const conns = this.byUser.get(userId);
    if (!conns) return {};
    for (const connectionId of conns) {
      const location = this.connections.get(connectionId)?.location;
      if (location?.callChannelId) {
        return {
          callChannelId: location.callChannelId,
          callTranscribing: location.callTranscribing,
        };
      }
    }
    return {};
  }

  private winningConnectionId(userId: string): string | null {
    const conns = this.byUser.get(userId);
    if (!conns) return null;

    let winner: string | null = null;
    let bestSeq = 0;
    for (const connectionId of conns) {
      const record = this.connections.get(connectionId);
      if (!record?.location) continue;
      if (record.seq > bestSeq) {
        bestSeq = record.seq;
        winner = connectionId;
      }
    }
    return winner;
  }
}
