/**
 * Shared Convex return validators — used across multiple query/mutation files.
 *
 * These validators describe the shape of enriched documents returned to clients.
 * They are NOT schema validators — they mirror the schema plus any joined fields.
 */
import { v } from "convex/values";

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
  setsStartDate: v.optional(v.boolean()),
});

export const userValidator = v.object({
  _id: v.id("users"),
  _creationTime: v.number(),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  emailVerificationTime: v.optional(v.number()),
  image: v.optional(v.string()),
  isAnonymous: v.optional(v.boolean()),
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
  tags: v.optional(v.array(v.string())),
});
