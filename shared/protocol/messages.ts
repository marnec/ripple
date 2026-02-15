/**
 * WebSocket protocol message types for PartyKit collaboration.
 *
 * This module defines the bidirectional message protocol between clients and
 * the PartyKit server. All messages use a discriminated union pattern with a
 * `type` field for type-safe message handling.
 *
 * Note: Yjs sync messages (ArrayBuffer wire protocol) are handled separately
 * by y-partykit. These types cover custom application-level messages only.
 */

import type { ErrorCode } from "./errors";

/**
 * Protocol version identifier.
 *
 * Clients and server exchange this during handshake to ensure compatibility.
 * Increment when making breaking changes to the protocol.
 */
export const PROTOCOL_VERSION = 1;

/**
 * HTTP header name for protocol version negotiation.
 *
 * Future use: Server can reject connections with incompatible protocol versions.
 */
export const PROTOCOL_HEADER = "x-ripple-protocol";

/**
 * Client-to-server messages.
 *
 * Messages sent from frontend clients to the PartyKit collaboration server.
 */
export type ClientMessage =
  | AuthMessage
  | TokenRefreshMessage
  | SyncRequestMessage
  | PresenceUpdateMessage;

/**
 * Client sends authentication token.
 *
 * **Phase 16**: Replaces URL-based token auth. Client sends this message
 * immediately after WebSocket connection opens.
 *
 * **Sender**: Client (frontend)
 * **Receiver**: PartyKit server
 * **Response**: Server replies with `auth_ok` or `auth_error`
 */
export interface AuthMessage {
  type: "auth";
  /** JWT token from Convex auth */
  token: string;
}

/**
 * Client sends refreshed authentication token.
 *
 * **Phase 16**: Implements token rotation without disconnection. Client sends
 * this when receiving a `TOKEN_REFRESH_REQUIRED` error or proactively before
 * token expiration.
 *
 * **Sender**: Client (frontend)
 * **Receiver**: PartyKit server
 * **Response**: Server validates and updates connection's token, sends `auth_ok` or `auth_error`
 */
export interface TokenRefreshMessage {
  type: "token_refresh";
  /** New JWT token from Convex auth */
  token: string;
}

/**
 * Client requests full state synchronization.
 *
 * **Phase 15**: Allows client to request a full snapshot from server if local
 * state is suspected to be inconsistent or after network interruption.
 *
 * **Sender**: Client (frontend)
 * **Receiver**: PartyKit server
 * **Response**: Server sends full Yjs state update, replies with `sync_complete`
 */
export interface SyncRequestMessage {
  type: "sync_request";
}

/**
 * Server-to-client messages.
 *
 * Messages sent from PartyKit collaboration server to frontend clients.
 */
export type ServerMessage =
  | AuthOkMessage
  | AuthErrorMessage
  | ErrorMessage
  | UserJoinedMessage
  | UserLeftMessage
  | SyncCompleteMessage
  | PermissionRevokedMessage
  | ServiceStatusMessage
  | PresenceSnapshotMessage
  | PresenceChangedMessage
  | UserLeftPresenceMessage;

/**
 * Server confirms successful authentication.
 *
 * **Phase 16**: Sent in response to `auth` or `token_refresh` message.
 * Includes user identity for awareness features.
 *
 * **Sender**: PartyKit server
 * **Receiver**: Client (frontend)
 * **Action**: Client proceeds with collaboration, updates local user state
 */
export interface AuthOkMessage {
  type: "auth_ok";
  /** Convex user document ID */
  userId: string;
  /** User's display name */
  userName: string;
}

/**
 * Server rejects authentication attempt.
 *
 * Sent when token is missing, expired, invalid, or user lacks room permissions.
 *
 * **Sender**: PartyKit server
 * **Receiver**: Client (frontend)
 * **Action**: Client shows error UI, redirects to login if terminal
 */
export interface AuthErrorMessage {
  type: "auth_error";
  /** Specific auth error code (AUTH_MISSING, AUTH_EXPIRED, AUTH_INVALID, AUTH_FORBIDDEN) */
  code: ErrorCode;
}

/**
 * Server reports a non-auth error.
 *
 * Generic error message for sync failures, server errors, connection issues.
 *
 * **Sender**: PartyKit server
 * **Receiver**: Client (frontend)
 * **Action**: Client checks error severity, retries if recoverable, shows UI if terminal
 */
export interface ErrorMessage {
  type: "error";
  /** Error code indicating the failure type */
  code: ErrorCode;
}

/**
 * Server notifies that a user joined the room.
 *
 * Used for presence awareness (showing who's currently editing). Sent to all
 * connected clients when a new user successfully authenticates.
 *
 * **Sender**: PartyKit server
 * **Receiver**: All clients in room
 * **Action**: Client updates presence UI (avatars, cursors)
 */
export interface UserJoinedMessage {
  type: "user_joined";
  /** Convex user document ID */
  userId: string;
  /** User's display name */
  userName: string;
  /** User's assigned color for cursors/highlights */
  userColor: string;
}

/**
 * Server notifies that a user left the room.
 *
 * Sent when a user disconnects (graceful disconnect or connection timeout).
 *
 * **Sender**: PartyKit server
 * **Receiver**: All remaining clients in room
 * **Action**: Client removes user from presence UI
 */
export interface UserLeftMessage {
  type: "user_left";
  /** Convex user document ID */
  userId: string;
}

/**
 * Server confirms successful snapshot persistence.
 *
 * **Phase 15**: Sent after PartyKit successfully persists Yjs snapshot to Convex.
 * Clients can use this to know their edits are durably stored.
 *
 * **Sender**: PartyKit server
 * **Receiver**: All clients in room
 * **Action**: Client can show "saved" indicator, update IndexedDB cache
 */
export interface SyncCompleteMessage {
  type: "sync_complete";
  /** Version number of the persisted snapshot (monotonically increasing) */
  snapshotVersion: number;
}

/**
 * Server notifies that user's permission was revoked.
 *
 * **Phase 16**: Sent when user's access to a document/diagram/task is removed
 * while they're connected. Server will close connection after sending this.
 *
 * **Sender**: PartyKit server
 * **Receiver**: Specific client whose permission was revoked
 * **Action**: Client shows notification, redirects away from resource
 */
export interface PermissionRevokedMessage {
  type: "permission_revoked";
  /** Human-readable reason (e.g., "Removed from document", "Document deleted") */
  reason: string;
}

/**
 * Server reports collaboration service health status.
 *
 * **Phase 17**: Sent when service enters/exits degraded mode or becomes unavailable.
 * Allows graceful degradation (read-only mode, local-only editing).
 *
 * **Sender**: PartyKit server
 * **Receiver**: All clients in room
 * **Action**: Client adjusts UI (show warning, disable features, switch to local mode)
 */
export interface ServiceStatusMessage {
  type: "service_status";
  /** Whether collaboration service is available */
  available: boolean;
  /** Reason for degradation if available=false (e.g., "Convex unavailable", "High load") */
  degradedReason?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Presence messages (workspace-level navigation tracking via PartyKit)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Client sends its current location within the workspace.
 *
 * Sent on route change while connected to the presence party.
 * No debounce needed — WebSocket messages are cheap.
 *
 * **Sender**: Client (frontend)
 * **Receiver**: PartyKit presence server
 * **Response**: Server broadcasts `presence_changed` to all other connections
 */
export interface PresenceUpdateMessage {
  type: "presence_update";
  /** Current route path (e.g., "/workspaces/123/channels/456") */
  currentPath: string;
  /** Type of resource being viewed */
  resourceType?: string;
  /** ID of the specific resource */
  resourceId?: string;
}

/**
 * Server sends full presence snapshot on initial connect.
 *
 * Contains all currently-online users and their locations.
 *
 * **Sender**: PartyKit presence server
 * **Receiver**: Newly connected client
 */
export interface PresenceSnapshotMessage {
  type: "presence_snapshot";
  users: Array<{
    userId: string;
    userName: string;
    userImage: string | null;
    currentPath: string;
    resourceType?: string;
    resourceId?: string;
  }>;
}

/**
 * Server broadcasts when any user's location changes.
 *
 * Sent to all connections except the sender.
 *
 * **Sender**: PartyKit presence server
 * **Receiver**: All other clients in the presence room
 */
export interface PresenceChangedMessage {
  type: "presence_changed";
  userId: string;
  userName: string;
  userImage: string | null;
  currentPath: string;
  resourceType?: string;
  resourceId?: string;
}

/**
 * Server broadcasts when a user disconnects from the presence room.
 *
 * Only sent when the user's last connection closes (supports multi-tab).
 *
 * **Sender**: PartyKit presence server
 * **Receiver**: All remaining clients in the presence room
 */
export interface UserLeftPresenceMessage {
  type: "user_left_presence";
  userId: string;
}
