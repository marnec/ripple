/**
 * Tracks which awareness clients (cursors, name badges) belong to which
 * connection, so a departed connection's cursor can be removed from the shared
 * awareness map.
 *
 * Why we track this ourselves rather than leaning on the library:
 *
 *  - The departing tab is supposed to announce itself, but y-partyserver's
 *    provider does that from a `window unload` listener, which modern browsers
 *    no longer fire reliably when a tab is closed.
 *  - y-protocols' own stale-state sweep is explicitly disabled by that same
 *    provider (`clearInterval(awareness._checkInterval)`), so nothing on the
 *    client side ever expires a cursor either.
 *  - The server's awareness map is replayed in full to every new connection,
 *    so a cursor left behind is handed out again on each reload — a ghost that
 *    outlives the tab that made it.
 *
 * That leaves the server as the only place that reliably knows a connection is
 * gone. Ownership is derived from awareness updates as they arrive (an update
 * carrying client id N from connection C means C owns N), and any client id
 * whose owning connection is no longer live is a ghost.
 *
 * Pure and transport-free so it can be unit tested without a Durable Object.
 */

export interface AwarenessChanges {
  added: number[];
  updated: number[];
  removed: number[];
}

export class AwarenessOwnership {
  private byConnection = new Map<string, Set<number>>();

  /** Attribute the client ids in an awareness update to the connection it came from. */
  record(connectionId: string, changes: AwarenessChanges): void {
    const owned = this.byConnection.get(connectionId) ?? new Set<number>();
    for (const clientId of changes.added) owned.add(clientId);
    for (const clientId of changes.updated) owned.add(clientId);
    for (const clientId of changes.removed) owned.delete(clientId);

    if (owned.size === 0) this.byConnection.delete(connectionId);
    else this.byConnection.set(connectionId, owned);
  }

  /** Forget a connection, returning the client ids it was responsible for. */
  release(connectionId: string): number[] {
    const owned = this.byConnection.get(connectionId);
    if (!owned) return [];
    this.byConnection.delete(connectionId);
    return [...owned];
  }

  /**
   * Of the client ids currently in the awareness map, those whose owning
   * connection is gone (or that no connection ever claimed). Also drops
   * bookkeeping for connections that are no longer live, so this doubles as
   * the periodic compaction step.
   */
  ghosts(presentClientIds: Iterable<number>, liveConnectionIds: Iterable<string>): number[] {
    const live = new Set(liveConnectionIds);

    for (const connectionId of [...this.byConnection.keys()]) {
      if (!live.has(connectionId)) this.byConnection.delete(connectionId);
    }

    const owned = new Set<number>();
    for (const ids of this.byConnection.values()) {
      for (const clientId of ids) owned.add(clientId);
    }

    const ghosts: number[] = [];
    for (const clientId of presentClientIds) {
      if (!owned.has(clientId)) ghosts.push(clientId);
    }
    return ghosts;
  }
}
