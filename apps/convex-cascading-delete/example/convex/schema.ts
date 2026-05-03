/*
(1.) Example application schema demonstrating multi-level cascading relationships
(2.) Five-level hierarchy: organizations → teams → members/projects → tasks → comments
(3.) Indexes configured for efficient cascade traversal

This schema represents a realistic organizational structure with multiple relationship
types and depths. Each table includes foreign key fields and corresponding indexes
that enable the cascading delete component to efficiently traverse and delete related
documents. The structure demonstrates both single-path cascades (organizations → teams)
and multi-path cascades (teams → members AND projects), showcasing the component's
ability to handle complex relationship graphs.
*/

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  organizations: defineTable({
    name: v.string(),
    description: v.string(),
  }),

  teams: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    description: v.string(),
  }).index("byOrganizationId", ["organizationId"]),

  members: defineTable({
    teamId: v.id("teams"),
    name: v.string(),
    email: v.string(),
    role: v.string(),
  }).index("byTeamId", ["teamId"]),

  projects: defineTable({
    teamId: v.id("teams"),
    name: v.string(),
    description: v.string(),
    status: v.union(v.literal("active"), v.literal("completed"), v.literal("archived")),
  }).index("byTeamId", ["teamId"]),

  tasks: defineTable({
    projectId: v.id("projects"),
    title: v.string(),
    description: v.string(),
    status: v.union(
      v.literal("todo"),
      v.literal("in_progress"),
      v.literal("done")
    ),
    assignedTo: v.optional(v.string()),
  }).index("byProjectId", ["projectId"]),

  comments: defineTable({
    taskId: v.id("tasks"),
    authorName: v.string(),
    text: v.string(),
  }).index("byTaskId", ["taskId"]),
});
