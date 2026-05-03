/*
(1.) Inserts a small sample dataset for the demo UI
(2.) Creates 1 organization, 1 team, 2 members, 1 project, 1 task, 2 comments
(3.) Small enough for inline (single-transaction) cascade deletion

Inserts a minimal org hierarchy so users can try inline cascading deletes
immediately. The guided tour uses this as its first data-seeding step.
*/

import { v } from "convex/values";
import { mutation } from "./_generated/server.js";

/**
 * Seeds sample data for demonstration.
 */
export const seedSampleData = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Acme Corporation",
      description: "A sample organization for testing cascading deletes",
    });

    const teamId = await ctx.db.insert("teams", {
      organizationId: orgId,
      name: "Engineering",
      description: "Product development team",
    });

    await ctx.db.insert("members", {
      teamId,
      name: "Alice Johnson",
      email: "alice@acme.com",
      role: "Engineer",
    });

    await ctx.db.insert("members", {
      teamId,
      name: "Bob Smith",
      email: "bob@acme.com",
      role: "Manager",
    });

    const projectId = await ctx.db.insert("projects", {
      teamId,
      name: "Website Redesign",
      description: "Modernize company website",
      status: "active",
    });

    const taskId = await ctx.db.insert("tasks", {
      projectId,
      title: "Design homepage mockup",
      description: "Create initial design concepts",
      status: "in_progress",
      assignedTo: "Alice Johnson",
    });

    await ctx.db.insert("comments", {
      taskId,
      authorName: "Bob Smith",
      text: "Looking good! Can we add more color?",
    });

    await ctx.db.insert("comments", {
      taskId,
      authorName: "Alice Johnson",
      text: "Sure, I'll update the palette.",
    });

    return orgId;
  },
});
