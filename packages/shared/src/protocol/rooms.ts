/**
 * Room ID construction and resource type definitions for PartyKit collaboration.
 *
 * Room IDs follow the pattern: `{resourceType}-{resourceId}`
 * This convention is used across the collaboration stack (Convex, PartyKit, frontend).
 */

/**
 * Resource types that support real-time collaboration via PartyKit.
 */
export type ResourceType = "doc" | "diagram" | "task" | "presence" | "spreadsheet";

/**
 * Build a PartyKit room ID from a resource type and ID.
 *
 * @param resourceType - The type of collaborative resource (doc, diagram, or task)
 * @param resourceId - The Convex document ID for the resource
 * @returns Room ID in the format "{resourceType}-{resourceId}"
 *
 * @example
 * buildRoomId("doc", "abc123") // "doc-abc123"
 * buildRoomId("diagram", "xyz789") // "diagram-xyz789"
 */
export function buildRoomId(
  resourceType: ResourceType,
  resourceId: string
): string {
  return `${resourceType}-${resourceId}`;
}

/**
 * Parse a PartyKit room ID into its resource type and ID components.
 *
 * @param roomId - Room ID in the format "{resourceType}-{resourceId}"
 * @returns Object with resourceType and resourceId
 * @throws Error if room ID format is invalid
 *
 * @example
 * parseRoomId("doc-abc123") // { resourceType: "doc", resourceId: "abc123" }
 */
export function parseRoomId(roomId: string): {
  resourceType: ResourceType;
  resourceId: string;
} {
  const parts = roomId.split("-");
  if (parts.length < 2) {
    throw new Error(`Invalid room ID format: ${roomId}`);
  }

  const resourceType = parts[0];
  const resourceId = parts.slice(1).join("-"); // Handle IDs with hyphens

  if (
    resourceType !== "doc" &&
    resourceType !== "diagram" &&
    resourceType !== "task" &&
    resourceType !== "presence" &&
    resourceType !== "spreadsheet"
  ) {
    throw new Error(`Invalid resource type in room ID: ${resourceType}`);
  }

  return { resourceType, resourceId };
}

/**
 * Build a complete PartyKit WebSocket connection URL.
 *
 * @param host - PartyKit host (e.g., "localhost:1999" or "myapp.partykit.dev")
 * @param roomId - Room ID to connect to
 * @param token - Authentication token for the connection
 * @returns WebSocket URL with token as query parameter
 *
 * @example
 * buildPartyKitUrl("localhost:1999", "doc-abc123", "token123")
 * // "ws://localhost:1999/parties/main/doc-abc123?token=token123"
 */
export function buildPartyKitUrl(
  host: string,
  roomId: string,
  token: string
): string {
  const protocol = host.startsWith("localhost") ? "ws" : "wss";
  return `${protocol}://${host}/parties/main/${roomId}?token=${encodeURIComponent(token)}`;
}
