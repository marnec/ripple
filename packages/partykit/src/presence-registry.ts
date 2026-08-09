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
   * Record a location for a connection. Returns the user's derived entry —
   * always this connection's, since it just became the most recent writer — or
   * null if the connection is unknown (closed mid-flight).
   */
  update(connectionId: string, location: PresenceLocation): PresenceEntry | null {
    const record = this.connections.get(connectionId);
    if (!record) return null;

    record.location = location;
    record.seq = ++this.seq;

    return { ...record.identity, ...location };
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
    return { ...record.identity, ...record.location };
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
