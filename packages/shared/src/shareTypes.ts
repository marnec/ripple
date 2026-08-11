/**
 * Guest share-link types shared between backend, frontend, and partyserver.
 *
 * Shareable surfaces:
 *   - documents / diagrams / spreadsheets → `view` or `edit`
 *   - channels → `join` (call access only, no chat)
 *   - calendarEvents → `join` (RSVP + call access for invited guests)
 *
 * The `ShareResourceType` vocabulary is user-facing (`document`). The Yjs room
 * prefix uses a shorter vocabulary (`doc`). Use `yjsResourceTypeForShare` to
 * translate between them.
 */

/**
 * Every shareable surface, mapped to the Yjs room kind it collaborates through
 * — or `null` when it has no collaborative document at all (channel and
 * calendarEvent shares grant call/RSVP access only).
 *
 * This map is the single source of truth for *both* directions of the
 * translation. Deriving the inverse rather than hand-writing it is the point:
 * a cascade going the other way ends in an implicit `else`, so a new room kind
 * would silently take the last branch instead of failing to compile.
 */
export const SHARE_RESOURCE_YJS_ROOMS = {
  document: "doc",
  diagram: "diagram",
  spreadsheet: "spreadsheet",
  channel: null,
  calendarEvent: null,
} as const;

export type ShareResourceType = keyof typeof SHARE_RESOURCE_YJS_ROOMS;

export const SHARE_RESOURCE_TYPES = Object.keys(
  SHARE_RESOURCE_YJS_ROOMS,
) as ShareResourceType[];

/** The room kinds reachable through a guest share — a subset of all rooms. */
export type YjsShareRoom = NonNullable<
  (typeof SHARE_RESOURCE_YJS_ROOMS)[ShareResourceType]
>;

/**
 * The inverse map, derived. Key remapping to `never` drops the entries whose
 * room is `null`, so this contains exactly the shareable rooms.
 */
export type ShareResourceTypeByYjsRoom = {
  [K in ShareResourceType as NonNullable<
    (typeof SHARE_RESOURCE_YJS_ROOMS)[K]
  >]: K;
};

const SHARE_RESOURCE_BY_YJS_ROOM = Object.fromEntries(
  Object.entries(SHARE_RESOURCE_YJS_ROOMS)
    .filter(([, room]) => room !== null)
    .map(([shareType, room]) => [room, shareType]),
) as ShareResourceTypeByYjsRoom;

/**
 * Every room kind a guest share can reach, as a runtime list. Derived from the
 * inverse map for the same reason the map itself is: a hand-written copy is a
 * copy that can drift.
 */
export const YJS_SHARE_ROOMS = Object.keys(
  SHARE_RESOURCE_BY_YJS_ROOM,
) as YjsShareRoom[];

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
): YjsShareRoom | null {
  return SHARE_RESOURCE_YJS_ROOMS[resourceType];
}

/**
 * The inverse of `yjsResourceTypeForShare`: which shareable surface a Yjs room
 * belongs to. Total by construction — the parameter type only admits rooms that
 * appear in the map, so there is no fallback branch to get wrong.
 */
export function shareResourceTypeForYjs<R extends YjsShareRoom>(
  room: R,
): ShareResourceTypeByYjsRoom[R] {
  return SHARE_RESOURCE_BY_YJS_ROOM[room];
}

export function isValidAccessLevelForResource(
  resourceType: ShareResourceType,
  accessLevel: ShareAccessLevel,
): boolean {
  if (resourceType === "channel" || resourceType === "calendarEvent") {
    return accessLevel === "join";
  }
  return accessLevel === "view" || accessLevel === "edit";
}

export const GUEST_SUB_PREFIX = "guest:";

export function isGuestSub(sub: string): boolean {
  return sub.startsWith(GUEST_SUB_PREFIX);
}
