import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { vSeverity } from "./shared.js";

export default defineSchema({
  /**
   * Main audit log table storing all audit events.
   */
  auditLogs: defineTable({
    // Core event data
    action: v.string(),
    actorId: v.optional(v.string()),
    timestamp: v.number(),

    // Resource tracking
    resourceType: v.optional(v.string()),
    resourceId: v.optional(v.string()),

    // Event metadata
    metadata: v.optional(v.any()),
    severity: vSeverity,

    // Context information
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    sessionId: v.optional(v.string()),

    // Compliance tags
    tags: v.optional(v.array(v.string())),

    // Change tracking
    before: v.optional(v.any()),
    after: v.optional(v.any()),
    diff: v.optional(v.string()),

    // Retention category for cleanup policies
    retentionCategory: v.optional(v.string()),

    // Hierarchical scope for filtering (e.g. workspaceId)
    scope: v.optional(v.string()),
  })
    // Query by action type with time ordering
    .index("by_action_timestamp", ["action", "timestamp"])
    // Query by actor (user) with time ordering
    .index("by_actor_timestamp", ["actorId", "timestamp"])
    // Query by resource with time ordering
    .index("by_resource", ["resourceType", "resourceId", "timestamp"])
    // Query by action + resource for rate-limiting checks
    .index("by_action_resource", ["action", "resourceId", "timestamp"])
    // Query by severity level with time ordering
    .index("by_severity_timestamp", ["severity", "timestamp"])
    // Query by timestamp for time-range queries
    .index("by_timestamp", ["timestamp"])
    // Query by retention category for cleanup
    .index("by_retention_timestamp", ["retentionCategory", "timestamp"])
    // Query by scope with time ordering (e.g. all activity in a workspace)
    .index("by_scope_timestamp", ["scope", "timestamp"])
    // Query by scope + resource type with time ordering (filtered activity feeds)
    .index("by_scope_resourceType_timestamp", ["scope", "resourceType", "timestamp"]),

  /**
   * Configuration table for component settings.
   * Contains a single document with global configuration.
   */
  config: defineTable({
    // Retention settings
    defaultRetentionDays: v.number(),
    criticalRetentionDays: v.number(),

    // PII redaction settings
    piiFieldsToRedact: v.array(v.string()),

    // Sampling settings (for high-volume apps)
    samplingEnabled: v.boolean(),
    samplingRate: v.number(), // 0.0 to 1.0

    // Custom retention categories
    customRetention: v.optional(
      v.array(
        v.object({
          category: v.string(),
          retentionDays: v.number(),
        })
      )
    ),
  }),
});
