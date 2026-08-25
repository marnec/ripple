import { Server } from "partyserver";
import type { Connection, ConnectionContext, WSMessage } from "partyserver";
import type {
  ErrorCode,
  ServerMessage,
  PresenceSnapshotMessage,
  PresenceChangedMessage,
  UserLeftPresenceMessage,
} from "@ripple/shared/protocol";
import { verifyToken } from "./token-utils";
import { PresenceRegistry } from "./presence-registry";

interface ConnectionState {
  userId: string;
  userName: string;
  userImage: string | null;
}

interface Env {
  CONVEX_SITE_URL: string;
  PARTYKIT_SECRET: string;
}

const PERMISSION_CHECK_INTERVAL = 120_000; // 2 minutes

/**
 * Presence server for workspace-level navigation tracking.
 *
 * One room per workspace (room ID = workspaceId). Pure in-memory broadcast —
 * no Yjs, no persistence. Disconnection = automatic removal.
 *
 * Multi-tab support: state is kept per connection and collapsed to one entry
 * per user on read (see `PresenceRegistry`), so a user's tabs can't overwrite
 * each other's location and closing one tab falls back to another rather than
 * stranding the user on a page they left.
 *
 * The HMAC token is checked once, at connect time, and its 5-minute TTL bounds
 * only *new* connections. A live socket is re-validated on the same
 * `PERMISSION_CHECK_INTERVAL` alarm the collaboration server uses — without it
 * a member removed from the workspace keeps receiving every colleague's
 * `currentPath` for as long as their tab stays open.
 */
export default class PresenceServer extends Server {
  private registry = new PresenceRegistry();
  private permissionCheckScheduled = false;

  async onConnect(
    conn: Connection,
    ctx: ConnectionContext,
  ) {
    const url = new URL(ctx.request.url);
    const token = url.searchParams.get("token");

    if (!token) {
      const msg: ServerMessage = {
        type: "auth_error",
        code: "AUTH_MISSING" as ErrorCode,
      };
      conn.send(JSON.stringify(msg));
      conn.close(1008, "AUTH_MISSING");
      return;
    }

    const env = this.env as Env;
    const secret = env.PARTYKIT_SECRET;
    if (!secret) {
      const msg: ServerMessage = {
        type: "error",
        code: "SERVER_CONFIG_ERROR" as ErrorCode,
      };
      conn.send(JSON.stringify(msg));
      conn.close(1011, "SERVER_CONFIG_ERROR");
      return;
    }

    // Verify HMAC-signed token locally — no callback to Convex needed
    const userData = await verifyToken(token, secret);

    if (!userData || userData.roomId !== `presence-${this.name}`) {
      const msg: ServerMessage = {
        type: "auth_error",
        code: "AUTH_INVALID" as ErrorCode,
      };
      conn.send(JSON.stringify(msg));
      conn.close(1008, "AUTH_INVALID");
      return;
    }

    // Store user identity on connection
    const state: ConnectionState = {
      userId: userData.userId,
      userName: userData.userName,
      userImage: userData.userImage,
    };
    conn.setState(state);

    // Track this connection for the user
    this.registry.add(conn.id, state);

    // Send current presence snapshot to the new connection
    const snapshot: PresenceSnapshotMessage = {
      type: "presence_snapshot",
      users: this.registry.snapshot(),
    };
    conn.send(JSON.stringify(snapshot));

    // Start the re-validation loop for the room (idempotent).
    if (!this.permissionCheckScheduled) {
      await this.ctx.storage.setAlarm(Date.now() + PERMISSION_CHECK_INTERVAL);
      this.permissionCheckScheduled = true;
    }
  }

  onMessage(conn: Connection, message: WSMessage) {
    if (typeof message !== "string") return;
    const state = conn.state as ConnectionState | undefined;
    if (!state?.userId) return;

    try {
      const data = JSON.parse(message);
      if (data.type !== "presence_update") return;
      if (typeof data.currentPath !== "string") return;

      const entry = this.registry.update(conn.id, {
        currentPath: data.currentPath,
        resourceType: data.resourceType,
        resourceId: data.resourceId,
        callChannelId:
          typeof data.callChannelId === "string" ? data.callChannelId : undefined,
      });
      if (!entry) return;

      // This connection just became the most recent writer, so the derived
      // entry is its own — broadcast it to all OTHER connections.
      const changed: PresenceChangedMessage = { type: "presence_changed", ...entry };
      this.broadcast(JSON.stringify(changed), [conn.id]);
    } catch {
      // Malformed message — ignore
    }
  }

  onError(_conn: Connection, error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("Network connection lost")) return;
    console.error(`Presence connection error in workspace ${this.name}:`, error);
  }

  onClose(conn: Connection, _code: number, _reason: string, _wasClean: boolean) {
    this.releaseConnection(conn.id);
  }

  /**
   * Drop a connection from the registry and tell the room what changed.
   * Idempotent — `registry.remove` returns null for a connection it has already
   * forgotten — because a server-initiated `conn.close()` is not guaranteed to
   * come back through `onClose`, so the revocation path calls this directly.
   */
  private releaseConnection(connectionId: string) {
    const removal = this.registry.remove(connectionId);
    if (!removal) return;

    if (removal.kind === "left") {
      // Last connection for this user — they're gone from the workspace
      const leftMsg: UserLeftPresenceMessage = {
        type: "user_left_presence",
        userId: removal.userId,
      };
      this.broadcast(JSON.stringify(leftMsg), [connectionId]);
      return;
    }

    // Another tab of the same user is still open and now represents them —
    // correct everyone's view instead of leaving the closed tab's location.
    const changed: PresenceChangedMessage = {
      type: "presence_changed",
      ...removal.entry,
    };
    this.broadcast(JSON.stringify(changed), [connectionId]);
  }

  // ---------------------------------------------------------------------------
  // Permission re-validation
  // ---------------------------------------------------------------------------

  /**
   * Re-check every live connection, then reschedule while the room is occupied.
   * The room empties → the tick that finds no connections stops the loop, and
   * the next `onConnect` starts it again.
   */
  async onAlarm() {
    let connectionCount = 0;
    for (const _ of this.getConnections()) connectionCount++;

    if (connectionCount === 0) {
      this.permissionCheckScheduled = false;
      return;
    }

    await this.checkPermissions();
    await this.ctx.storage.setAlarm(Date.now() + PERMISSION_CHECK_INTERVAL);
    this.permissionCheckScheduled = true;
  }

  /**
   * Ask Convex whether each connected user still belongs to this workspace and
   * close the ones that don't. `hasResourceAccess` already answers for
   * `presence-<workspaceId>` rooms by checking workspace membership, so this
   * needs no backend change.
   */
  private async checkPermissions(): Promise<void> {
    const env = this.env as Env;
    const convexSiteUrl = env.CONVEX_SITE_URL;
    const secret = env.PARTYKIT_SECRET;
    if (!convexSiteUrl || !secret) return;

    const roomId = `presence-${this.name}`;

    for (const conn of this.getConnections()) {
      const state = conn.state as ConnectionState | undefined;
      if (!state?.userId) continue;

      try {
        const url = new URL(`${convexSiteUrl}/collaboration/check-access`);
        url.searchParams.set("roomId", roomId);
        url.searchParams.set("userId", state.userId);

        const response = await fetch(url.toString(), {
          method: "GET",
          headers: { "Authorization": `Bearer ${secret}` },
        });

        // A failed check is not a revocation — leave the connection alone and
        // retry on the next tick rather than evicting the room on a blip.
        if (!response.ok) continue;

        const data: { hasAccess: boolean } = await response.json();
        if (data.hasAccess) continue;

        console.log(
          `Presence access revoked for user ${state.userId} in workspace ${this.name}`,
        );
        const msg: ServerMessage = {
          type: "permission_revoked",
          reason: "Your access to this workspace has been revoked",
        };
        conn.send(JSON.stringify(msg));
        conn.close(1008, "AUTH_FORBIDDEN");
        this.releaseConnection(conn.id);
      } catch (error) {
        console.error(
          `Presence permission check failed for user ${state.userId}:`,
          error,
        );
      }
    }
  }
}
