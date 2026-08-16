/**
 * Shared Convex return validators — used across multiple query/mutation files.
 *
 * These validators describe the shape of enriched documents returned to clients.
 * They are NOT schema validators — they mirror the schema plus any joined fields.
 */
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

export const cycleStatusValidator = v.union(
  v.literal("draft"),
  v.literal("upcoming"),
  v.literal("active"),
  v.literal("completed"),
);

export const priorityValidator = v.union(
  v.literal("urgent"),
  v.literal("high"),
  v.literal("medium"),
  v.literal("low"),
);

export const taskStatusValidator = v.object({
  _id: v.id("taskStatuses"),
  _creationTime: v.number(),
  projectId: v.id("projects"),
  name: v.string(),
  color: v.string(),
  order: v.number(),
  isDefault: v.boolean(),
  isCompleted: v.boolean(),
  isTriage: v.optional(v.boolean()),
  setsStartDate: v.optional(v.boolean()),
  pendingDeletion: v.optional(v.boolean()),
  // GitHub integration: drives `state_reason` on outbound close. Optional
  // because most projects won't have an integration linked.
  externalCloseReason: v.optional(
    v.union(v.literal("completed"), v.literal("not_planned")),
  ),
});

export const userValidator = v.object({
  _id: v.id("users"),
  _creationTime: v.number(),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  emailVerificationTime: v.optional(v.number()),
  image: v.optional(v.string()),
  isAnonymous: v.optional(v.boolean()),
  // Synthetic users (integration bots etc.) carry isBot=true so the
  // frontend can render external-author identity instead of bot identity
  // on task creators / comment authors / facepiles.
  isBot: v.optional(v.boolean()),
  // Canonical (lowercase) GitHub login, captured at OAuth sign-in. Present on
  // the user doc, so it must be allowed through anywhere a full user row is
  // returned (e.g. users.viewer, task/cycle assignee).
  githubLogin: v.optional(v.string()),
  // GitLab identity captured at OAuth sign-in (numeric id + lowercase username),
  // same reasoning as githubLogin above — must pass through full-user-row returns.
  gitlabUserId: v.optional(v.string()),
  gitlabLogin: v.optional(v.string()),
  // Platform-admin flag (see schema.ts). Surfaced on the user row so the admin
  // app can gate its UI; the server still re-checks on every admin function.
  isPlatformAdmin: v.optional(v.boolean()),
  // Account-disabled flag (see schema.ts). Surfaced so the admin app can show a
  // disabled badge; sign-in enforcement is server-side in auth.ts.
  disabled: v.optional(v.boolean()),
});

/**
 * The subset of a user row safe to hand to any authenticated caller purely on
 * the strength of holding their id — avatars, @-mention chips, reaction
 * facepiles. Deliberately omits `email`, `isPlatformAdmin` and `disabled`:
 * `users.get`/`getByIds` are id-addressable with no workspace scoping, so
 * returning the full `userValidator` there published an account-takeover
 * targeting list. Email and admin flags stay behind the scoped endpoints
 * (`users.viewer`, `workspaceMembers.membersByWorkspace`, `admin/*`).
 */
export const publicUserValidator = v.object({
  _id: v.id("users"),
  _creationTime: v.number(),
  name: v.optional(v.string()),
  image: v.optional(v.string()),
  isBot: v.optional(v.boolean()),
});

export const referenceValidator = v.object({
  _id: v.id("edges"),
  sourceType: v.string(),
  sourceId: v.string(),
  sourceName: v.string(),
  edgeType: v.string(),
  workspaceId: v.string(),
  projectId: v.optional(v.string()),
});

export const favoritableResourceTypeValidator = v.union(
  v.literal("document"),
  v.literal("diagram"),
  v.literal("spreadsheet"),
  v.literal("project"),
);

export const browsableResourceTypeValidator = v.union(
  v.literal("channel"),
  v.literal("document"),
  v.literal("diagram"),
  v.literal("spreadsheet"),
  v.literal("project"),
);

export const deletionResultValidator = v.union(
  v.object({ status: v.literal("deleted") }),
  v.object({ status: v.literal("has_references"), references: v.array(referenceValidator) }),
);

export const projectValidator = v.object({
  _id: v.id("projects"),
  _creationTime: v.number(),
  name: v.string(),
  description: v.optional(v.string()),
  color: v.string(),
  workspaceId: v.id("workspaces"),
  creatorId: v.id("users"),
  key: v.optional(v.string()),
  taskCounter: v.optional(v.number()),
});

/**
 * Project a project row onto exactly the columns `projectValidator` declares.
 *
 * `projects.get` / `list` / `search` return raw documents, so any column the
 * validator does not declare fails the WHOLE query rather than the one row —
 * and a spread is not excess-property-checked, so `tsc` never sees it.
 */
export function pickProjectFields(project: Doc<"projects">) {
  return {
    _id: project._id,
    _creationTime: project._creationTime,
    name: project.name,
    description: project.description,
    color: project.color,
    workspaceId: project.workspaceId,
    creatorId: project.creatorId,
    key: project.key,
    taskCounter: project.taskCounter,
  };
}
