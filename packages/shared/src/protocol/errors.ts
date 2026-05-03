/**
 * Error codes and severity classification for PartyKit WebSocket protocol.
 *
 * Error codes are used in ServerMessage error responses and for connection
 * close reasons. Each error has a severity (recoverable vs terminal) to guide
 * client retry logic.
 */

/**
 * Error codes for protocol-level failures.
 *
 * **Auth errors** - Authentication/authorization failures:
 * - `AUTH_MISSING` - No token provided (sent by server)
 * - `AUTH_EXPIRED` - Token has expired (sent by server, Phase 16)
 * - `AUTH_INVALID` - Token signature/format invalid (sent by server)
 * - `AUTH_FORBIDDEN` - User lacks permission to access room (sent by server)
 *
 * **Room errors** - Room state issues:
 * - `ROOM_NOT_FOUND` - Room doesn't exist (sent by server)
 * - `ROOM_FULL` - Room has reached capacity limit (sent by server)
 *
 * **Sync errors** - Data synchronization problems:
 * - `SYNC_CONFLICT` - Yjs merge conflict detected (sent by server, Phase 15)
 * - `SYNC_FAILED` - Failed to sync state to client (sent by server, Phase 15)
 *
 * **Server errors** - Server-side failures:
 * - `SERVER_CONFIG_ERROR` - Server misconfiguration (missing env vars, etc.)
 * - `SERVER_INTERNAL_ERROR` - Unexpected server error
 *
 * **Connection errors** - Network/connection issues:
 * - `CONNECTION_TIMEOUT` - Connection establishment timed out (sent by client or server)
 * - `CONNECTION_CLOSED` - Connection closed unexpectedly (sent by client or server)
 *
 * **Persistence errors (Phase 15)** - Snapshot/persistence issues:
 * - `PERSIST_FAILED` - Failed to persist Yjs snapshot to Convex (sent by server)
 * - `PERSIST_STALE_SNAPSHOT` - Snapshot version conflict (sent by server)
 *
 * **Token refresh (Phase 16)** - Token lifecycle:
 * - `TOKEN_REFRESH_REQUIRED` - Client must refresh token (sent by server)
 *
 * **Degradation (Phase 17)** - Service health:
 * - `SERVICE_UNAVAILABLE` - Collaboration service unavailable (sent by server)
 * - `DEGRADED_MODE` - Running in degraded mode (sent by server)
 */
export type ErrorCode =
  // Auth errors
  | "AUTH_MISSING"
  | "AUTH_EXPIRED"
  | "AUTH_INVALID"
  | "AUTH_FORBIDDEN"
  // Room errors
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  // Sync errors
  | "SYNC_CONFLICT"
  | "SYNC_FAILED"
  // Server errors
  | "SERVER_CONFIG_ERROR"
  | "SERVER_INTERNAL_ERROR"
  // Connection errors
  | "CONNECTION_TIMEOUT"
  | "CONNECTION_CLOSED"
  // Persistence errors (Phase 15)
  | "PERSIST_FAILED"
  | "PERSIST_STALE_SNAPSHOT"
  // Token refresh (Phase 16)
  | "TOKEN_REFRESH_REQUIRED"
  // Degradation (Phase 17)
  | "SERVICE_UNAVAILABLE"
  | "DEGRADED_MODE";

/**
 * Error severity classification.
 *
 * - `recoverable` - Client can retry the operation (e.g., token refresh, sync retry)
 * - `terminal` - Client must stop and notify user (e.g., auth failure, server error)
 */
export type ErrorSeverity = "recoverable" | "terminal";

/**
 * Mapping of error codes to their severity.
 *
 * **Terminal errors** require user intervention or indicate permanent failure:
 * - Auth errors (except TOKEN_REFRESH_REQUIRED)
 * - Server configuration errors
 * - Server internal errors
 *
 * **Recoverable errors** can be retried automatically:
 * - Connection/network errors
 * - Sync conflicts
 * - Persistence failures
 * - Token refresh required
 * - Service degradation
 */
export const ERROR_SEVERITY: Record<ErrorCode, ErrorSeverity> = {
  // Auth errors - mostly terminal
  AUTH_MISSING: "terminal",
  AUTH_EXPIRED: "terminal", // Client should have refreshed proactively
  AUTH_INVALID: "terminal",
  AUTH_FORBIDDEN: "terminal",

  // Room errors - terminal (user can't fix)
  ROOM_NOT_FOUND: "terminal",
  ROOM_FULL: "terminal",

  // Sync errors - recoverable
  SYNC_CONFLICT: "recoverable",
  SYNC_FAILED: "recoverable",

  // Server errors - terminal
  SERVER_CONFIG_ERROR: "terminal",
  SERVER_INTERNAL_ERROR: "terminal",

  // Connection errors - recoverable
  CONNECTION_TIMEOUT: "recoverable",
  CONNECTION_CLOSED: "recoverable",

  // Persistence errors - recoverable (Phase 15)
  PERSIST_FAILED: "recoverable",
  PERSIST_STALE_SNAPSHOT: "recoverable",

  // Token refresh - recoverable (Phase 16)
  TOKEN_REFRESH_REQUIRED: "recoverable",

  // Degradation - recoverable (Phase 17)
  SERVICE_UNAVAILABLE: "recoverable",
  DEGRADED_MODE: "recoverable",
};
