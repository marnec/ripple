import type * as Party from "partykit/server";
import { onConnect } from "y-partykit";

export default class CollaborationServer implements Party.Server {
  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    // y-partykit handles:
    // - Yjs document sync (onConnect, onMessage, onDisconnect)
    // - Snapshot mode persistence (auto-compact on last client disconnect)
    // - Durable Objects storage (state persists across server restarts)
    //
    // Room ID format: "doc-{documentId}" or "diagram-{diagramId}"
    // Each room is an isolated Durable Object with its own Yjs document.
    //
    // Auth will be added in Plan 02 via onBeforeConnect static handler.
    return onConnect(conn, this.room, {
      persist: { mode: "snapshot" },
    });
  }
}
