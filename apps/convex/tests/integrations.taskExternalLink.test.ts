import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";
import {
  setTaskExternalLink,
  clearTaskExternalLink,
  insertTaskWithExternalLink,
  markTaskExternalLinkDeleted,
} from "../convex/integrations/core/taskExternalLink";
import type { Id } from "../convex/_generated/dataModel";

// Audit log component's deferred aggregate updates must not fire on real
// timers and corrupt convex-test state (mirrors links.test.ts).
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function setupProjectWithTask(t: ReturnType<typeof createTestContext>) {
  const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });
  const statusId = await t.run((ctx) =>
    ctx.db.insert("taskStatuses", {
      projectId,
      name: "Todo",
      color: "bg-slate-500",
      order: 0,
      isDefault: true,
      isCompleted: false,
      isTriage: false,
    }),
  );
  const taskId = await t.run((ctx) =>
    ctx.db.insert("tasks", {
      projectId,
      workspaceId,
      title: "Task",
      statusId,
      priority: "medium",
      completed: false,
      creatorId: userId,
      number: 1,
    }),
  );
  return { userId, workspaceId, projectId, taskId };
}

const REF = {
  provider: "github",
  repoFullName: "acme/web",
  issueNumber: 42,
  url: "https://github.com/acme/web/issues/42",
};

function lookupRows(
  t: ReturnType<typeof createTestContext>,
  taskId: Id<"tasks">,
) {
  return t.run((ctx) =>
    ctx.db
      .query("taskExternalRefs")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect(),
  );
}

describe("integrations/core/taskExternalLink.setTaskExternalLink", () => {
  it("writes the ref to tasks.externalRefs AND mirrors it into the lookup", async () => {
    const t = createTestContext();
    const { projectId, taskId } = await setupProjectWithTask(t);

    await t.run((ctx) =>
      setTaskExternalLink(ctx, { taskId, projectId, ref: REF }),
    );

    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.externalRefs).toEqual([REF]);

    const rows = await lookupRows(t, taskId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      taskId,
      projectId,
      repoFullName: "acme/web",
      issueNumber: 42,
    });
  });
});

describe("integrations/core/taskExternalLink.insertTaskWithExternalLink", () => {
  it("inserts the task with the ref set and mirrors it into the lookup, returning the id", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });
    const statusId = await t.run((ctx) =>
      ctx.db.insert("taskStatuses", {
        projectId,
        name: "Todo",
        color: "bg-slate-500",
        order: 0,
        isDefault: true,
        isCompleted: false,
        isTriage: false,
      }),
    );

    const taskId = await t.run((ctx) =>
      insertTaskWithExternalLink(ctx, {
        task: {
          projectId,
          workspaceId,
          title: "From GitHub",
          statusId,
          priority: "medium",
          completed: false,
          creatorId: userId,
          number: 7,
        },
        ref: REF,
      }),
    );

    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.title).toBe("From GitHub");
    expect(task?.externalRefs).toEqual([REF]);

    const rows = await lookupRows(t, taskId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ repoFullName: "acme/web", issueNumber: 42 });
  });
});

describe("integrations/core/taskExternalLink.clearTaskExternalLink", () => {
  it("clears tasks.externalRefs, empties the lookup, and applies alsoPatch in the same write", async () => {
    const t = createTestContext();
    const { projectId, taskId } = await setupProjectWithTask(t);
    await t.run((ctx) =>
      setTaskExternalLink(ctx, { taskId, projectId, ref: REF }),
    );

    const frozen = {
      provider: "github",
      externalRepoId: "R_kgDOACME",
      repoFullName: "acme/web",
      issueNumber: 42,
      externalIssueId: "I_abc",
      url: REF.url,
      disconnectedAt: 1234,
    };
    await t.run((ctx) =>
      clearTaskExternalLink(ctx, {
        taskId,
        alsoPatch: { externalRefFrozen: frozen },
      }),
    );

    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.externalRefs).toBeUndefined();
    expect(task?.externalRefFrozen).toMatchObject({ externalIssueId: "I_abc" });
    expect(await lookupRows(t, taskId)).toHaveLength(0);
  });
});

describe("integrations/core/taskExternalLink.markTaskExternalLinkDeleted", () => {
  it("flags refs deleted but keeps the lookup row so the issue stays resolvable", async () => {
    const t = createTestContext();
    const { projectId, taskId } = await setupProjectWithTask(t);
    await t.run((ctx) =>
      setTaskExternalLink(ctx, { taskId, projectId, ref: REF }),
    );

    await t.run((ctx) => markTaskExternalLinkDeleted(ctx, { taskId }));

    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.externalRefs).toEqual([{ ...REF, deleted: true }]);
    // The repo#issue key is unchanged, so the lookup row survives — a PR that
    // closes a deleted-upstream issue can still resolve the task.
    const rows = await lookupRows(t, taskId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ repoFullName: "acme/web", issueNumber: 42 });
  });

  it("no-ops when the task has no external refs", async () => {
    const t = createTestContext();
    const { taskId } = await setupProjectWithTask(t);

    await t.run((ctx) => markTaskExternalLinkDeleted(ctx, { taskId }));

    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.externalRefs).toBeUndefined();
    expect(await lookupRows(t, taskId)).toHaveLength(0);
  });
});
