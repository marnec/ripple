import { Server } from "partyserver";
import type { Connection, ConnectionContext, WSMessage } from "partyserver";
import type {
  ErrorCode,
  ServerMessage,
  PresenceSnapshotMessage,
  PresenceChangedMessage,
  UserLeftPresenceMessage,
} from "@shared/protocol";
import { verifyToken } from "./token-utils";

interface ConnectionState {
  userId: string;
  userName: string;
  userImage: string | null;
}

interface PresenceEntry {
  userId: string;
  userName: string;
  userImage: string | null;
  currentPath: string;
  resourceType?: string;
  resourceId?: string;
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
 * Multi-tab support: tracks Set<connectionId> per userId. A user is only
 * removed from presence when their last tab disconnects.
 */
export default class PresenceServer extends Server {
  private presenceMap: Map<string, PresenceEntry> = new Map();
  private userConnections: Map<string, Set<string>> = new Map();

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
    const conns = this.userConnections.get(userData.userId) ?? new Set();
    conns.add(conn.id);
    this.userConnections.set(userData.userId, conns);

    // Send current presence snapshot to the new connection
    const snapshot: PresenceSnapshotMessage = {
      type: "presence_snapshot",
      users: Array.from(this.presenceMap.values()),
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

      const entry: PresenceEntry = {
        userId: state.userId,
        userName: state.userName,
        userImage: state.userImage,
        currentPath: data.currentPath,
        resourceType: data.resourceType,
        resourceId: data.resourceId,
      };

      this.presenceMap.set(state.userId, entry);

      // Broadcast to all OTHER connections
      const changed: PresenceChangedMessage = {
        type: "presence_changed",
        userId: state.userId,
        userName: state.userName,
        userImage: state.userImage,
        currentPath: data.currentPath,
        resourceType: data.resourceType,
        resourceId: data.resourceId,
      };
      this.broadcast(JSON.stringify(changed), [conn.id]);
    } catch {
      // Malformed message — ignore
    }
  }

  onClose(conn: Connection, _code: number, _reason: string, _wasClean: boolean) {
    const state = conn.state as ConnectionState | undefined;
    if (!state?.userId) return;

    // Remove this connection from the user's set
    const conns = this.userConnections.get(state.userId);
    if (conns) {
      conns.delete(conn.id);
      if (conns.size === 0) {
        // Last connection for this user — remove from presence and broadcast
        this.userConnections.delete(state.userId);
        this.presenceMap.delete(state.userId);

        const leftMsg: UserLeftPresenceMessage = {
          type: "user_left_presence",
          userId: state.userId,
        };
        this.broadcast(JSON.stringify(leftMsg));
      }
    }
  }
}
