/**
 * Zod runtime validation schemas for WebSocket protocol messages.
 *
 * These schemas provide runtime type checking for messages received over
 * the WebSocket connection, catching malformed data before it reaches
 * application code.
 */

import { z } from "zod";
import type { ClientMessage, ServerMessage } from "./messages";
import type { ErrorCode } from "./errors";

/**
 * Schema for error code validation.
 */
export const errorCodeSchema = z.enum([
  // Auth errors
  "AUTH_MISSING",
  "AUTH_EXPIRED",
  "AUTH_INVALID",
  "AUTH_FORBIDDEN",
  // Room errors
  "ROOM_NOT_FOUND",
  "ROOM_FULL",
  // Sync errors
  "SYNC_CONFLICT",
  "SYNC_FAILED",
  // Server errors
  "SERVER_CONFIG_ERROR",
  "SERVER_INTERNAL_ERROR",
  // Connection errors
  "CONNECTION_TIMEOUT",
  "CONNECTION_CLOSED",
  // Persistence errors (Phase 15)
  "PERSIST_FAILED",
  "PERSIST_STALE_SNAPSHOT",
  // Token refresh (Phase 16)
  "TOKEN_REFRESH_REQUIRED",
  // Degradation (Phase 17)
  "SERVICE_UNAVAILABLE",
  "DEGRADED_MODE",
]) satisfies z.ZodType<ErrorCode>;

/**
 * Schema for client-to-server auth message.
 */
const authMessageSchema = z.object({
  type: z.literal("auth"),
  token: z.string().min(1),
});

/**
 * Schema for client-to-server token refresh message.
 */
const tokenRefreshMessageSchema = z.object({
  type: z.literal("token_refresh"),
  token: z.string().min(1),
});

/**
 * Schema for client-to-server sync request message.
 */
const syncRequestMessageSchema = z.object({
  type: z.literal("sync_request"),
});

/**
 * Schema for client-to-server presence update message.
 */
const presenceUpdateMessageSchema = z.object({
  type: z.literal("presence_update"),
  currentPath: z.string().min(1),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
});

/**
 * Schema for all client-to-server messages.
 */
export const clientMessageSchema = z.discriminatedUnion("type", [
  authMessageSchema,
  tokenRefreshMessageSchema,
  syncRequestMessageSchema,
  presenceUpdateMessageSchema,
]) satisfies z.ZodType<ClientMessage>;

/**
 * Schema for server-to-client auth success message.
 */
const authOkMessageSchema = z.object({
  type: z.literal("auth_ok"),
  userId: z.string().min(1),
  userName: z.string(),
});

/**
 * Schema for server-to-client auth error message.
 */
const authErrorMessageSchema = z.object({
  type: z.literal("auth_error"),
  code: errorCodeSchema,
});

/**
 * Schema for server-to-client generic error message.
 */
const errorMessageSchema = z.object({
  type: z.literal("error"),
  code: errorCodeSchema,
});

/**
 * Schema for server-to-client user joined message.
 */
const userJoinedMessageSchema = z.object({
  type: z.literal("user_joined"),
  userId: z.string().min(1),
  userName: z.string(),
  userColor: z.string().min(1),
});

/**
 * Schema for server-to-client user left message.
 */
const userLeftMessageSchema = z.object({
  type: z.literal("user_left"),
  userId: z.string().min(1),
});

/**
 * Schema for server-to-client sync complete message.
 */
const syncCompleteMessageSchema = z.object({
  type: z.literal("sync_complete"),
  snapshotVersion: z.number().int().nonnegative(),
});

/**
 * Schema for server-to-client permission revoked message.
 */
const permissionRevokedMessageSchema = z.object({
  type: z.literal("permission_revoked"),
  reason: z.string(),
});

/**
 * Schema for server-to-client service status message.
 */
const serviceStatusMessageSchema = z.object({
  type: z.literal("service_status"),
  available: z.boolean(),
  degradedReason: z.string().optional(),
});

/**
 * Schema for server-to-client presence snapshot message.
 */
const presenceSnapshotMessageSchema = z.object({
  type: z.literal("presence_snapshot"),
  users: z.array(
    z.object({
      userId: z.string().min(1),
      userName: z.string(),
      userImage: z.string().nullable(),
      currentPath: z.string(),
      resourceType: z.string().optional(),
      resourceId: z.string().optional(),
    }),
  ),
});

/**
 * Schema for server-to-client presence changed message.
 */
const presenceChangedMessageSchema = z.object({
  type: z.literal("presence_changed"),
  userId: z.string().min(1),
  userName: z.string(),
  userImage: z.string().nullable(),
  currentPath: z.string(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
});

/**
 * Schema for server-to-client user left presence message.
 */
const userLeftPresenceMessageSchema = z.object({
  type: z.literal("user_left_presence"),
  userId: z.string().min(1),
});

/**
 * Schema for all server-to-client messages.
 */
export const serverMessageSchema = z.discriminatedUnion("type", [
  authOkMessageSchema,
  authErrorMessageSchema,
  errorMessageSchema,
  userJoinedMessageSchema,
  userLeftMessageSchema,
  syncCompleteMessageSchema,
  permissionRevokedMessageSchema,
  serviceStatusMessageSchema,
  presenceSnapshotMessageSchema,
  presenceChangedMessageSchema,
  userLeftPresenceMessageSchema,
]) satisfies z.ZodType<ServerMessage>;

/**
 * Schema for room ID validation.
 *
 * Room IDs must match the pattern: {resourceType}-{resourceId}
 * where resourceType is "doc", "diagram", or "task"
 */
export const roomIdSchema = z
  .string()
  .regex(/^(doc|diagram|task|presence)-.+$/, "Room ID must be {resourceType}-{resourceId}");

/**
 * Parse and validate a client message, throwing on invalid data.
 *
 * @param data - Unknown data to parse (typically from JSON.parse)
 * @returns Validated ClientMessage
 * @throws ZodError if data doesn't match schema
 */
export function parseClientMessage(data: unknown): ClientMessage {
  return clientMessageSchema.parse(data);
}

/**
 * Parse and validate a server message, throwing on invalid data.
 *
 * @param data - Unknown data to parse (typically from JSON.parse)
 * @returns Validated ServerMessage
 * @throws ZodError if data doesn't match schema
 */
export function parseServerMessage(data: unknown): ServerMessage {
  return serverMessageSchema.parse(data);
}

/**
 * Safely parse and validate a client message without throwing.
 *
 * @param data - Unknown data to parse
 * @returns SafeParseReturnType with success boolean and data or error
 */
export function safeParseClientMessage(data: unknown) {
  return clientMessageSchema.safeParse(data);
}

/**
 * Safely parse and validate a server message without throwing.
 *
 * @param data - Unknown data to parse
 * @returns SafeParseReturnType with success boolean and data or error
 */
export function safeParseServerMessage(data: unknown) {
  return serverMessageSchema.safeParse(data);
}
