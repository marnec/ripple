/**
 * Resource-type mapping between the workspace graph and the audit log, and the
 * `resourceTypes` argument the activity feed sends for a given set of hidden
 * graph nodes.
 */

/** Singular type (graph node) → plural resourceType (audit log). */
export const SINGULAR_TO_RESOURCE_TYPE: Record<string, string> = {
  document: "documents",
  diagram: "diagrams",
  spreadsheet: "spreadsheets",
  channel: "channels",
  project: "projects",
  task: "tasks",
};

/** Plural resourceType (audit log) → singular type (graph node). */
export const RESOURCE_TYPE_TO_GRAPH_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(SINGULAR_TO_RESOURCE_TYPE).map(([singular, plural]) => [plural, singular]),
);

const ALL_RESOURCE_TYPES = Object.values(SINGULAR_TO_RESOURCE_TYPE);

/**
 * Audit resource types with no node in the graph, so no eye-toggle can ever
 * hide them — membership, invite, cycle, calendar and share-link activity,
 * plus the workspace itself.
 *
 * They ride along with every filtered query. The graph's default state hides
 * `tag`, so `hiddenTypes` is non-empty on first paint; without these the feed
 * silently narrowed to the six graph types and a workspace admin never saw
 * "invited X", "changed role", "left the workspace" or "revoked a share link"
 * at all.
 */
const NON_GRAPH_RESOURCE_TYPES = [
  "workspaces",
  "cycles",
  "channelMembers",
  "workspaceInvites",
  "calendarEvents",
  "shares",
];

/**
 * `undefined` — meaning "no filter" — whenever nothing the timeline renders is
 * hidden. That is not just tidiness: it keeps the backend on its single
 * `by_scope_timestamp` index instead of a merged stream per type.
 */
export function timelineResourceTypes(hiddenTypes?: Set<string>): string[] | undefined {
  if (!hiddenTypes || hiddenTypes.size === 0) return undefined;
  const visible = ALL_RESOURCE_TYPES.filter(
    (rt) => !hiddenTypes.has(RESOURCE_TYPE_TO_GRAPH_TYPE[rt]),
  );
  if (visible.length === ALL_RESOURCE_TYPES.length) return undefined;
  return [...visible, ...NON_GRAPH_RESOURCE_TYPES];
}
