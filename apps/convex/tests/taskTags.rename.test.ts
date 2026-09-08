import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { auditLog, logActivity } from "../convex/auditLog";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";

/**
 * `tasks.labels` → `tasks.tags`, and the audit verbs that went with it. The
 * product has said "tags" everywhere a user can see for a while; this pins the
 * data and the activity trail to the same word. (`migrateTaskLabelsToTags` has
 * no test: with the legacy column gone from the schema, convex-test refuses to
 * seed a row that carries it.)
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
