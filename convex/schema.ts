import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

// The schema is normally optional, but Convex Auth
// requires indexes defined on `authTables`.
// The schema provides more precise TypeScript types.
export default defineSchema({
  ...authTables,
  messages: defineTable({
    userId: v.id("users"),
    body: v.string(),
    channelId: v.id("channels")
  }).index("by_channel", ["channelId"]),
  workspaces: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    ownerId: v.id("users")
  }),
  workspaceMembers: defineTable({
    userId: v.id("users"),
    workspaceId: v.id("workspaces"),
    role: v.union(v.literal("admin"), v.literal("member"))
  }).index("by_user", ["userId"])
    .index("by_workspace_user", ["workspaceId", "userId"]),
  channels: defineTable({
    name: v.string(),
    workspaceId: v.id("workspaces")
  }).index("by_workspace", ["workspaceId"])
});
