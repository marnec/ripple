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
  PARTYKIT_SECRET: string;
}

/**
 * Presence server for workspace-level navigation tracking.
 *
 * One room per workspace (room ID = workspaceId). Pure in-memory broadcast —
 * no Yjs, no alarms, no persistence. Disconnection = automatic removal.
 *
 * Multi-tab support: state is kept per connection and collapsed to one entry
 * per user on read (see `PresenceRegistry`), so a user's tabs can't overwrite
 * each other's location and closing one tab falls back to another rather than
 * stranding the user on a page they left.
 */
export default class PresenceServer extends Server {
  private registry = new PresenceRegistry();

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
    const removal = this.registry.remove(conn.id);
    if (!removal) return;

    if (removal.kind === "left") {
      // Last connection for this user — they're gone from the workspace
      const leftMsg: UserLeftPresenceMessage = {
        type: "user_left_presence",
        userId: removal.userId,
      };
      this.broadcast(JSON.stringify(leftMsg));
      return;
    }

    // Another tab of the same user is still open and now represents them —
    // correct everyone's view instead of leaving the closed tab's location.
    const changed: PresenceChangedMessage = {
      type: "presence_changed",
      ...removal.entry,
    };
    this.broadcast(JSON.stringify(changed));
  }
}
