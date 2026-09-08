import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { auditLog, logActivity } from "../convex/auditLog";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";

/**
 * `tasks.labels` → `tasks.tags`, and the audit verbs that went with it. The
 * product has said "tags" everywhere a user can see for a while; this pins the
 * data and the activity trail to the same word, plus the two bridges that let
 * rows written before the rename keep rendering: the read-time alias and the
 * data migrations.
 */

async function setupTask(t: ReturnType<typeof createTestContext>) {
  const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });
  await t.run((ctx) =>
    ctx.db.insert("taskStatuses", {
      projectId, name: "Todo", color: "bg-gray-500", order: 0, isDefault: true, isCompleted: false,
    }),
  );
  const taskId = await asUser.mutation(api.tasks.create, {
    projectId, workspaceId, title: "Tagged", tags: ["bug"],
  });
  return { userId, workspaceId, asUser, taskId };
}

describe("task tag activity", () => {
  it("logs tag_add / tag_remove with the tag name on each side", async () => {
    const t = createTestContext();
    const { asUser, taskId } = await setupTask(t);

    await asUser.mutation(api.tasks.update, { taskId, tags: ["docs"] });

    const timeline = await asUser.query(api.taskActivity.timeline, { taskId });
    const tagEvents = timeline
      .filter((i) => i.kind === "activity" && i.type.startsWith("tag_"))
      .map((i) => (i.kind === "activity" ? `${i.type}:${i.oldValue ?? ""}:${i.newValue ?? ""}` : ""))
      .sort();
    expect(tagEvents).toEqual(["tag_add::docs", "tag_remove:bug:"]);
  });

  it("reads a pre-rename label_* row under its current verb everywhere", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser, taskId } = await setupTask(t);
    await t.run((ctx) =>
      logActivity(ctx, {
        userId, resourceType: "tasks", resourceId: taskId, action: "label_remove",
        resourceName: "Tagged", oldValue: "legacy", scope: workspaceId,
      }),
    );

    const timeline = await asUser.query(api.taskActivity.timeline, { taskId });
    const legacy = timeline.find((i) => i.kind === "activity" && i.oldValue === "legacy");
    expect(legacy && legacy.kind === "activity" ? legacy.type : null).toBe("tag_remove");

    const workspace = await asUser.query(api.workspaceTimeline.list, { workspaceId });
    expect(workspace.find((e) => e.oldValue === "legacy")?.action).toBe("tasks.tag_remove");

    const { userId: adminId, asUser: asAdmin } = await setupAuthenticatedUser(t, {
      name: "Operator", email: "operator@example.com",
    });
    await t.run((ctx) => ctx.db.patch(adminId, { isPlatformAdmin: true }));
    const admin = await asAdmin.query(api.admin.activity.list, { workspaceId });
    expect(admin.entries.find((e) => e.oldValue === "legacy")?.action).toBe("tasks.tag_remove");
  });

  it("migrateAuditLabelVerbs rewrites the stored verb, not just its rendering", async () => {
    const t = createTestContext();
    const { userId, workspaceId, taskId } = await setupTask(t);
    await t.run((ctx) =>
      logActivity(ctx, {
        userId, resourceType: "tasks", resourceId: taskId, action: "label_add",
        resourceName: "Tagged", newValue: "legacy", scope: workspaceId,
      }),
    );

    await t.mutation(internal.migrations.migrateAuditLabelVerbs, {});
    await t.finishAllScheduledFunctions(() => {});

    const rows = await t.run((ctx) =>
      auditLog.queryByResource(ctx, { resourceType: "tasks", resourceId: taskId }),
    );
    const actions = rows.map((r: { action: string }) => r.action);
    expect(actions).toContain("tasks.tag_add");
    expect(actions.some((a: string) => a.startsWith("tasks.label_"))).toBe(false);
  });
});

describe("migrateTaskLabelsToTags", () => {
  it("moves the legacy column across and leaves a post-rename row alone", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });
    const { legacyId, bothId, freshId } = await t.run(async (ctx) => {
      const statusId = await ctx.db.insert("taskStatuses", {
        projectId, name: "Todo", color: "bg-gray-500", order: 0, isDefault: true, isCompleted: false,
      });
      const base = {
        projectId, workspaceId, statusId, priority: "medium" as const,
        completed: false, creatorId: userId,
      };
      const legacyId = await ctx.db.insert("tasks", { ...base, title: "legacy", labels: ["bug"] });
      const bothId = await ctx.db.insert("tasks", { ...base, title: "both", labels: ["old"], tags: ["new"] });
      const freshId = await ctx.db.insert("tasks", { ...base, title: "fresh", tags: ["docs"] });
      return { legacyId, bothId, freshId };
    });

    await t.mutation(internal.migrations.migrateTaskLabelsToTags, { cursor: null, batchSize: 100 });
    await t.finishAllScheduledFunctions(() => {});

    const read = (id: Id<"tasks">) =>
      t.run(async (ctx) => {
        const row = (await ctx.db.get(id)) as { tags?: string[]; labels?: string[] } | null;
        return [row?.tags ?? null, row?.labels ?? null];
      });
    expect(await read(legacyId)).toEqual([["bug"], null]);
    expect(await read(bothId)).toEqual([["new"], null]);
    expect(await read(freshId)).toEqual([["docs"], null]);
  });
});
