/**
 * PartyKit collaboration protocol types and runtime validation.
 *
 * This module exports the complete type-safe protocol contract between
 * the PartyKit server and frontend clients. It provides:
 *
 * - TypeScript types for all WebSocket messages (compile-time safety)
 * - Zod schemas for runtime validation
 * - Error codes and severity classification
 * - Room ID utilities and resource type definitions
 *
 * Usage:
 * ```typescript
 * import {
 *   ServerMessage,
 *   ClientMessage,
 *   parseServerMessage,
 *   ErrorCode,
 *   buildRoomId,
 *   ResourceType,
 * } from "@shared/protocol";
 * ```
 */

// Message types
export type {
  ClientMessage,
  ServerMessage,
  AuthMessage,
  TokenRefreshMessage,
  SyncRequestMessage,
  PresenceUpdateMessage,
  AuthOkMessage,
  AuthErrorMessage,
  ErrorMessage,
  UserJoinedMessage,
  UserLeftMessage,
  SyncCompleteMessage,
  PermissionRevokedMessage,
  ServiceStatusMessage,
  PresenceSnapshotMessage,
  PresenceChangedMessage,
  UserLeftPresenceMessage,
} from "./messages";

export { PROTOCOL_VERSION, PROTOCOL_HEADER } from "./messages";

// Error types
export type { ErrorCode, ErrorSeverity } from "./errors";
export { ERROR_SEVERITY } from "./errors";

// Runtime validation schemas
export {
  errorCodeSchema,
  clientMessageSchema,
  serverMessageSchema,
  roomIdSchema,
  parseClientMessage,
  parseServerMessage,
  safeParseClientMessage,
  safeParseServerMessage,
} from "./schemas";

// Room utilities
export type { ResourceType } from "./rooms";
export { buildRoomId, parseRoomId, buildPartyKitUrl } from "./rooms";
