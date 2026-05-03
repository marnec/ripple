/**
 * Guest share-link types shared between backend, frontend, and partyserver.
 *
 * Shareable surfaces:
 *   - documents / diagrams / spreadsheets → `view` or `edit`
 *   - channels → `join` (call access only, no chat)
 *
 * The `ShareResourceType` vocabulary is user-facing (`document`). The Yjs room
 * prefix uses a shorter vocabulary (`doc`). Use `yjsResourceTypeForShare` to
 * translate between them.
 */

export const SHARE_RESOURCE_TYPES = [
  "document",
  "diagram",
  "spreadsheet",
  "channel",
] as const;

export type ShareResourceType = (typeof SHARE_RESOURCE_TYPES)[number];

export const SHARE_ACCESS_LEVELS = ["view", "edit", "join"] as const;

export type ShareAccessLevel = (typeof SHARE_ACCESS_LEVELS)[number];

/**
 * Map the share-table resource type to the Yjs room prefix used by
 * partyserver / collaboration tokens.
 *
 * Channels do not have Yjs rooms — shares for channels are call-only and
 * go through a separate Cloudflare RTK flow.
 */
export function yjsResourceTypeForShare(
  resourceType: ShareResourceType,
): "doc" | "diagram" | "spreadsheet" | null {
  switch (resourceType) {
    case "document":
      return "doc";
    case "diagram":
      return "diagram";
    case "spreadsheet":
      return "spreadsheet";
    case "channel":
      return null;
  }
}

export function isValidAccessLevelForResource(
  resourceType: ShareResourceType,
  accessLevel: ShareAccessLevel,
): boolean {
  if (resourceType === "channel") return accessLevel === "join";
  return accessLevel === "view" || accessLevel === "edit";
}

export const GUEST_SUB_PREFIX = "guest:";

export function isGuestSub(sub: string): boolean {
  return sub.startsWith(GUEST_SUB_PREFIX);
}
