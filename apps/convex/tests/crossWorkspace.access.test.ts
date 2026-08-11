/**
 * Cross-workspace access regression suite.
 *
 * The two existing access-rule suites (`messages.access.test.ts`,
 * `snapshots.access.test.ts`) are the right shape but only cover the channel
 * rule. This file covers the *workspace* rule against the one adversary those
 * suites never model: a caller who is a legitimate, fully-authorized member of
 * workspace A, reaching into workspace B.
 *
 * That distinction matters because the pre-existing tests in `tasks.test.ts`
 * and `edges.test.ts` assert only two things — an unauthenticated caller is
 * refused, and a stranger passing the *matching* `workspaceId` is refused.
 * Both exercise `requireWorkspaceMember` and stay green even when the handler
 * goes on to dereference a second, entirely unchecked id from another tenant.
 *
 * Two attack shapes are covered:
 *
 *   1. The caller names their OWN container and a FOREIGN child. The mutation
 *      authorizes `args.workspaceId` (or `args.cycleId`, or `statusIds[0]`),
 *      then dereferences a second caller-supplied id whose owning workspace is
 *      never compared against the authorized one.
 *
 *   2. The endpoint gates on `requireUser` — "is logged in" — and never loads
 *      the owning container at all.
 *
 * Every assertion here states the intended invariant, not current behaviour.
 * A failure means the vulnerability is live, and the assertion message names
 * the call site to fix.
 *
 * `callSessions.joinCall` is an action that reaches Cloudflare RealtimeKit, so
 * it runs against a mocked `realtimeKitFromEnv` (below) — the assertion that
 * matters is that the fake client is never touched, i.e. authorization happens
 * before the meeting is created.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import type { Id } from "../convex/_generated/dataModel";
import { ChannelRole, WorkspaceRole } from "@ripple/shared/enums/roles";
import { InviteStatus } from "@ripple/shared/enums/inviteStatus";

/**
 * `joinCall` creates the Cloudflare meeting when none is active, so the real
 * defect was not just "can read a call" — an unauthorized caller could make
 * the backend provision a meeting for a channel it cannot see. These spies
 * stand in for the network client; the test asserts they were never called.
 */
const rtkCreateMeeting = vi.fn(() => Promise.resolve({ id: "meeting-x" }));
const rtkAddParticipant = vi.fn(() => Promise.resolve({ token: "tok" }));
vi.mock("../convex/lib/realtimeKit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../convex/lib/realtimeKit")>()),
  realtimeKitFromEnv: () => ({
    createMeeting: rtkCreateMeeting,
    addParticipant: rtkAddParticipant,
    deleteMeeting: vi.fn(() => Promise.resolve()),
  }),
}));

// Matches tasks.test.ts: the audit-log component schedules aggregate updates
// that corrupt convex-test state if they fire freely.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

type TestCtx = ReturnType<typeof createTestContext>;

/** Project + the three seeded statuses, mirroring `projects.create`. */
async function setupProjectWithStatuses(
  t: TestCtx,
  opts: { workspaceId: Id<"workspaces">; userId: Id<"users">; name?: string; key?: string },
) {
  const { workspaceId, userId, name = "Project", key = "PRJ" } = opts;

  return t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name,
      color: "bg-blue-500",
      workspaceId,
      creatorId: userId,
      key,
      taskCounter: 0,
    });
    const todoId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Todo",
      color: "bg-gray-500",
      order: 0,
      isDefault: true,
      isCompleted: false,
    });
    const doingId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "In Progress",
      color: "bg-blue-500",
      order: 1,
      isDefault: false,
      isCompleted: false,
    });
    const doneId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Done",
      color: "bg-green-500",
      order: 2,
      isDefault: false,
      isCompleted: true,
    });
    return { projectId, todoId, doingId, doneId };
  });
}

/**
 * Two disjoint tenants. `alice` is an ADMIN of workspace A and has no row of
 * any kind in workspace B; `bob` is an ADMIN of B. Every test below runs as
 * alice — a caller with real, maximal privilege, just not here.
 */
async function setupTwoWorkspaces(t: TestCtx) {
  const a = await setupWorkspaceWithAdmin(t, "Workspace A");
  const bobUser = await setupAuthenticatedUser(t, {
    name: "Bob",
    email: "bob@b.test",
  });
  const workspaceB = await t.run(async (ctx) => {
    const wsId = await ctx.db.insert("workspaces", {
      name: "Workspace B",
      ownerId: bobUser.userId,
    });
    await ctx.db.insert("workspaceMembers", {
      userId: bobUser.userId,
      workspaceId: wsId,
      role: WorkspaceRole.ADMIN,
    });
    return wsId;
  });

  return {
    alice: { userId: a.userId, asUser: a.asUser, workspaceId: a.workspaceId },
    bob: { userId: bobUser.userId, asUser: bobUser.asUser, workspaceId: workspaceB },
  };
}

/* ══════════════════════════════════════════════════════════════════════
   Shape 1 — own container named, foreign child dereferenced
   ══════════════════════════════════════════════════════════════════════ */

describe("tasks.create — foreign projectId under an authorized workspaceId", () => {
  it("refuses a projectId owned by another workspace", async () => {
    const t = createTestContext();
    const { alice, bob } = await setupTwoWorkspaces(t);
    const { projectId: projectB } = await setupProjectWithStatuses(t, {
      workspaceId: bob.workspaceId,
      userId: bob.userId,
      key: "BBB",
    });

    await expect(
      alice.asUser.mutation(api.tasks.create, {
        // authorized: alice really is a member of A
        workspaceId: alice.workspaceId,
        // not authorized: this project lives in B
        projectId: projectB,
        title: "Injected",
      }),
      // convex/tasks.ts:136 — the guard exists at taskImports.ts:180
    ).rejects.toThrow();
  });

  it("leaves the victim project untouched when the call is refused", async () => {
    const t = createTestContext();
    const { alice, bob } = await setupTwoWorkspaces(t);
    const { projectId: projectB } = await setupProjectWithStatuses(t, {
      workspaceId: bob.workspaceId,
      userId: bob.userId,
      key: "BBB",
    });

    await alice.asUser
      .mutation(api.tasks.create, {
        workspaceId: alice.workspaceId,
        projectId: projectB,
        title: "Injected",
      })
      .catch(() => undefined);

    const state = await t.run(async (ctx) => {
      const tasks = await ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectB))
        .collect();
      const project = await ctx.db.get(projectB);
      return { taskCount: tasks.length, counter: project?.taskCounter ?? 0 };
    });

    expect(state.taskCount, "no task may be inserted into workspace B").toBe(0);
    expect(state.counter, "B's taskCounter must not be advanced").toBe(0);
  });

  it("refuses a statusId belonging to a different project", async () => {
    const t = createTestContext();
    const { alice, bob } = await setupTwoWorkspaces(t);
    const { projectId: projectA } = await setupProjectWithStatuses(t, {
      workspaceId: alice.workspaceId,
      userId: alice.userId,
      key: "AAA",
    });
    const { doneId: doneB } = await setupProjectWithStatuses(t, {
      workspaceId: bob.workspaceId,
      userId: bob.userId,
      key: "BBB",
    });

    await expect(
      alice.asUser.mutation(api.tasks.create, {
        workspaceId: alice.workspaceId,
        projectId: projectA,
        title: "Foreign status",
        statusId: doneB,
      }),
      // convex/tasks.ts:156 — status.projectId is never compared to args.projectId
    ).rejects.toThrow();
  });
});

describe("tasks.update / updatePosition — foreign statusId", () => {
  it("update refuses a statusId from another project", async () => {
    const t = createTestContext();
    const { alice, bob } = await setupTwoWorkspaces(t);
    const { projectId: projectA } = await setupProjectWithStatuses(t, {
      workspaceId: alice.workspaceId,
      userId: alice.userId,
      key: "AAA",
    });
    const { doneId: doneB } = await setupProjectWithStatuses(t, {
      workspaceId: bob.workspaceId,
      userId: bob.userId,
      key: "BBB",
    });

    const taskId = await alice.asUser.mutation(api.tasks.create, {
      workspaceId: alice.workspaceId,
      projectId: projectA,
      title: "Mine",
    });

    await expect(
      alice.asUser.mutation(api.tasks.update, { taskId, statusId: doneB }),
      // convex/tasks.ts:859 — the task silently leaves every kanban column
    ).rejects.toThrow();
  });

  it("updatePosition refuses a statusId from another project", async () => {
    const t = createTestContext();
    const { alice, bob } = await setupTwoWorkspaces(t);
    const { projectId: projectA } = await setupProjectWithStatuses(t, {
      workspaceId: alice.workspaceId,
      userId: alice.userId,
      key: "AAA",
    });
    const { doingId: doingB } = await setupProjectWithStatuses(t, {
      workspaceId: bob.workspaceId,
      userId: bob.userId,
      key: "BBB",
    });

    const taskId = await alice.asUser.mutation(api.tasks.create, {
      workspaceId: alice.workspaceId,
      projectId: projectA,
      title: "Mine",
    });

    await expect(
      alice.asUser.mutation(api.tasks.updatePosition, {
        taskId,
        statusId: doingB,
        position: "a0",
      }),
      // convex/tasks.ts:1059 — same omission on the kanban drag path
    ).rejects.toThrow();
  });
});

describe("cycles — foreign projectId and foreign taskId", () => {
  it("create refuses a projectId owned by another workspace", async () => {
    const t = createTestContext();
    const { alice, bob } = await setupTwoWorkspaces(t);
    const { projectId: projectB } = await setupProjectWithStatuses(t, {
      workspaceId: bob.workspaceId,
      userId: bob.userId,
      key: "BBB",
    });

    await expect(
      alice.asUser.mutation(api.cycles.create, {
        workspaceId: alice.workspaceId,
        projectId: projectB,
        name: "Injected cycle",
      }),
      // convex/cycles.ts:59 — mirror of the tasks.create defect
    ).rejects.toThrow();
  });

  it("addTask refuses a task from another workspace", async () => {
    const t = createTestContext();
    const { alice, bob } = await setupTwoWorkspaces(t);
    const { projectId: projectA } = await setupProjectWithStatuses(t, {
      workspaceId: alice.workspaceId,
      userId: alice.userId,
      key: "AAA",
    });
    const { projectId: projectB, todoId: todoB } = await setupProjectWithStatuses(t, {
      workspaceId: bob.workspaceId,
      userId: bob.userId,
      key: "BBB",
    });

    const cycleId = await alice.asUser.mutation(api.cycles.create, {
      workspaceId: alice.workspaceId,
      projectId: projectA,
      name: "Sprint 1",
    });

    const secretTaskId = await t.run(async (ctx) =>
      ctx.db.insert("tasks", {
        projectId: projectB,
        workspaceId: bob.workspaceId,
        title: "Acquisition of Initech",
        statusId: todoB,
        priority: "high" as const,
        completed: false,
        creatorId: bob.userId,
        number: 1,
      }),
    );

    await expect(
      alice.asUser.mutation(api.cycles.addTask, { cycleId, taskId: secretTaskId }),
      // convex/cycles.ts:250 — the gate is on the cycle, never the task
    ).rejects.toThrow();
  });

  it("listCycleTasks never returns a foreign task even if the join row exists", async () => {
    const t = createTestContext();
    const { alice, bob } = await setupTwoWorkspaces(t);
    const { projectId: projectA } = await setupProjectWithStatuses(t, {
      workspaceId: alice.workspaceId,
      userId: alice.userId,
      key: "AAA",
    });
    const { projectId: projectB, todoId: todoB } = await setupProjectWithStatuses(t, {
      workspaceId: bob.workspaceId,
      userId: bob.userId,
      key: "BBB",
    });

    const cycleId = await alice.asUser.mutation(api.cycles.create, {
      workspaceId: alice.workspaceId,
      projectId: projectA,
      name: "Sprint 1",
    });

    // Seed the join row directly: this asserts the *read* side is defended
    // independently of the write side, so fixing only `addTask` is not enough.
    await t.run(async (ctx) => {
      const taskId = await ctx.db.insert("tasks", {
        projectId: projectB,
        workspaceId: bob.workspaceId,
        title: "Acquisition of Initech",
        statusId: todoB,
        priority: "high" as const,
        completed: false,
        creatorId: bob.userId,
        number: 1,
      });
      await ctx.db.insert("cycleTasks", {
        cycleId,
        taskId,
        projectId: projectA,
        addedBy: alice.userId,
      });
    });

    const listed = await alice.asUser.query(api.cycles.listCycleTasks, { cycleId });

    expect(
      listed.map((task) => task.title),
      // convex/cycles.ts:385 — enrichedTaskValidator carries the assignee's email
    ).not.toContain("Acquisition of Initech");
  });
});

describe("taskStatuses.reorderColumns — only statusIds[0] is authorized", () => {
  it("refuses a batch containing a status from another workspace", async () => {
    const t = createTestContext();
    const { alice, bob } = await setupTwoWorkspaces(t);
    const { todoId: todoA } = await setupProjectWithStatuses(t, {
      workspaceId: alice.workspaceId,
      userId: alice.userId,
      key: "AAA",
    });
    const { todoId: todoB, doneId: doneB } = await setupProjectWithStatuses(t, {
      workspaceId: bob.workspaceId,
      userId: bob.userId,
      key: "BBB",
    });

    await expect(
      // index 0 is alice's own status, so the single check passes
      alice.asUser.mutation(api.taskStatuses.reorderColumns, {
        statusIds: [todoA, doneB, todoB],
      }),
      // convex/taskStatuses.ts:236 — the loop has no per-element check
    ).rejects.toThrow();

    const orders = await t.run(async (ctx) => ({
      todoB: (await ctx.db.get(todoB))?.order,
      doneB: (await ctx.db.get(doneB))?.order,
    }));

    expect(orders.todoB, "B's column order must be untouched").toBe(0);
    expect(orders.doneB, "B's column order must be untouched").toBe(2);
  });
});

describe("edges.syncEdges — foreign sourceId under an authorized workspaceId", () => {
  it("does not delete another workspace's embed edges", async () => {
    const t = createTestContext();
    const { alice, bob } = await setupTwoWorkspaces(t);

    const docB = await bob.asUser.mutation(api.documents.create, {
      workspaceId: bob.workspaceId,
      name: "B's doc",
    });
    const diagramB = await bob.asUser.mutation(api.diagrams.create, {
      workspaceId: bob.workspaceId,
      name: "B's diagram",
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("edges", {
        sourceType: "document" as const,
        sourceId: docB,
        targetType: "diagram" as const,
        targetId: diagramB,
        edgeType: "embeds" as const,
        workspaceId: bob.workspaceId,
        createdAt: Date.now(),
      });
    });

    await alice.asUser
      .mutation(api.edges.syncEdges, {
        sourceType: "document",
        // alice's own workspace — the only thing the handler checks
        workspaceId: alice.workspaceId,
        // a source that lives in B; the diff index has no workspace column
        sourceId: docB,
        // an empty reference list makes every existing edge a deletion
        references: [],
      })
      .catch(() => undefined);

    const remaining = await t.run(async (ctx) =>
      ctx.db
        .query("edges")
        .withIndex("by_source_edgetype", (q) =>
          q.eq("sourceId", docB).eq("edgeType", "embeds"),
        )
        .collect(),
    );

    expect(
      remaining.length,
      // convex/edges.ts:192 — cross-workspace destructive write
      "workspace B's edges must survive a syncEdges call made from workspace A",
    ).toBe(1);
  });

  it("does not fabricate an edge attributed to a foreign source", async () => {
    const t = createTestContext();
    const { alice, bob } = await setupTwoWorkspaces(t);

    const docB = await bob.asUser.mutation(api.documents.create, {
      workspaceId: bob.workspaceId,
      name: "B's doc",
    });
    const diagramA = await alice.asUser.mutation(api.diagrams.create, {
      workspaceId: alice.workspaceId,
      name: "A's diagram",
    });

    await alice.asUser
      .mutation(api.edges.syncEdges, {
        sourceType: "document",
        workspaceId: alice.workspaceId,
        sourceId: docB,
        references: [{ targetType: "diagram", targetId: diagramA }],
      })
      .catch(() => undefined);

    const forged = await t.run(async (ctx) =>
      ctx.db
        .query("edges")
        .withIndex("by_source", (q) => q.eq("sourceId", docB))
        .collect(),
    );

    expect(
      forged.length,
      "an edge must not be attributed to a document the caller cannot read",
    ).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Shape 2 — `requireUser` used as if it were an access rule
   ══════════════════════════════════════════════════════════════════════ */

/** Closed channel in B, with bob as its only member. */
async function setupClosedChannelInB(
  t: TestCtx,
  bob: { userId: Id<"users">; workspaceId: Id<"workspaces"> },
) {
  return t.run(async (ctx) => {
    const channelId = await ctx.db.insert("channels", {
      name: "b-private",
      workspaceId: bob.workspaceId,
      type: "closed" as const,
    });
    await ctx.db.insert("channelMembers", {
      channelId,
      workspaceId: bob.workspaceId,
      userId: bob.userId,
      role: ChannelRole.ADMIN,
      email: "bob@b.test",
      name: "Bob",
    });
    return channelId;
  });
}

describe("channelMembers.membersByChannel — private roster", () => {
  it("refuses a caller with no membership of the owning workspace", async () => {
    const t = createTestContext();
    const { alice, bob } = await setupTwoWorkspaces(t);
    const channelId = await setupClosedChannelInB(t, bob);

    const roster = await alice.asUser
      .query(api.channelMembers.membersByChannel, { channelId })
      // convex/channelMembers.ts:46 — requireUser only; channels row never loaded
      .catch(() => [] as { email?: string }[]);

    expect(
      roster,
      "a closed channel's roster (with emails) must not reach another tenant",
    ).toHaveLength(0);
  });
});

describe("messageReactions — reads and writes on an unreachable message", () => {
  it("listForMessage refuses a message in another workspace's closed channel", async () => {
    const t = createTestContext();
    const { alice, bob } = await setupTwoWorkspaces(t);
    const channelId = await setupClosedChannelInB(t, bob);

    const messageId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("messages", {
        body: "[]",
        plainText: "quarterly numbers",
        channelId,
        deleted: false,
        userId: bob.userId,
        isomorphicId: "iso-1",
      });
      await ctx.db.insert("messageReactions", {
        messageId: id,
        userId: bob.userId,
        emoji: "+1",
        emojiNative: "👍",
      });
      return id;
    });

    const groups = await alice.asUser
      .query(api.messageReactions.listForMessage, { messageId })
      // convex/messageReactions.ts:98 — leaks the reacting userIds
      .catch(() => []);

    expect(groups, "reactions on an unreachable message must not be readable").toHaveLength(0);
  });

  it("toggle refuses to write a reaction onto an unreachable message", async () => {
    const t = createTestContext();
    const { alice, bob } = await setupTwoWorkspaces(t);
    const channelId = await setupClosedChannelInB(t, bob);

    const messageId = await t.run(async (ctx) =>
      ctx.db.insert("messages", {
        body: "[]",
        plainText: "quarterly numbers",
        channelId,
        deleted: false,
        userId: bob.userId,
        isomorphicId: "iso-1",
      }),
    );

    await expect(
      alice.asUser.mutation(api.messageReactions.toggle, {
        messageId,
        emoji: "middle_finger",
        emojiNative: "🖕",
      }),
      // convex/messageReactions.ts:14 — an outsider's reaction renders for real members
    ).rejects.toThrow();
  });
});

describe("callSessions.joinCall — an A/V token for any channel", () => {
  it("refuses to mint a token for a channel the caller cannot reach", async () => {
    const t = createTestContext();
    const { alice, bob } = await setupTwoWorkspaces(t);
    const channelId = await setupClosedChannelInB(t, bob);

    rtkCreateMeeting.mockClear();
    rtkAddParticipant.mockClear();

    await expect(
      alice.asUser.action(api.callSessions.joinCall, {
        channelId,
        userName: "Not Bob",
      }),
      // convex/callSessions.ts:213 — only getAuthUserId, channel never loaded
    ).rejects.toThrow();

    expect(
      rtkCreateMeeting,
      "authorization must happen before Cloudflare is asked to create a meeting",
    ).not.toHaveBeenCalled();
    expect(rtkAddParticipant).not.toHaveBeenCalled();
  });

  it("still lets a real channel member join", async () => {
    const t = createTestContext();
    const { bob } = await setupTwoWorkspaces(t);
    const channelId = await setupClosedChannelInB(t, bob);

    rtkCreateMeeting.mockClear();

    const result = await bob.asUser.action(api.callSessions.joinCall, {
      channelId,
      userName: "Bob",
    });

    expect(result.meetingId).toBe("meeting-x");
    expect(rtkCreateMeeting).toHaveBeenCalledTimes(1);
  });
});

describe("callSessions.endSession — any authenticated user ends any call", () => {
  it("refuses to end a call in a channel the caller cannot reach", async () => {
    const t = createTestContext();
    const { alice, bob } = await setupTwoWorkspaces(t);
    const channelId = await setupClosedChannelInB(t, bob);

    await t.run(async (ctx) => {
      await ctx.db.insert("callSessions", {
        channelId,
        cloudflareMeetingId: "meeting-b",
        active: true,
      });
    });

    await alice.asUser
      .mutation(api.callSessions.endSession, { channelId })
      .catch(() => undefined);

    const stillActive = await t.run(async (ctx) =>
      ctx.db
        .query("callSessions")
        .withIndex("by_channel_active", (q) =>
          q.eq("channelId", channelId).eq("active", true),
        )
        .collect(),
    );

    expect(
      stillActive.length,
      // convex/callSessions.ts:142 — requireUser only; cheap DoS on any call
      "another tenant's call must not be terminable",
    ).toBe(1);
  });
});

describe("medias.getUrl — a storage id is a bearer capability", () => {
  it("refuses to sign a URL for a blob owned by another workspace", async () => {
    const t = createTestContext();
    const { alice, bob } = await setupTwoWorkspaces(t);

    const storageId = await t.run(async (ctx) => {
      const id = await ctx.storage.store(new Blob(["confidential"]));
      await ctx.db.insert("medias", {
        storageId: id,
        workspaceId: bob.workspaceId,
        uploadedBy: bob.userId,
        fileName: "cap-table.png",
        mimeType: "image/png",
        size: 12,
        type: "image" as const,
      });
      return id;
    });

    const url = await alice.asUser
      .query(api.medias.getUrl, { storageId })
      // convex/medias.ts:46 — the medias row (which carries workspaceId) is never read
      .catch(() => null);

    expect(url, "a signed blob URL must not cross a workspace boundary").toBeNull();
  });
});

describe("breadcrumb.getResourceNames — no auth on ten resource types", () => {
  it("does not resolve names for another workspace's resources", async () => {
    const t = createTestContext();
    const { alice, bob } = await setupTwoWorkspaces(t);

    const docB = await bob.asUser.mutation(api.documents.create, {
      workspaceId: bob.workspaceId,
      name: "Project Bluebird",
    });

    const names = await alice.asUser
      .query(api.breadcrumb.getResourceNames, { resourceIds: [docB] })
      // convex/breadcrumb.ts:33 — the file imports nothing from authHelpers
      .catch(() => ({}) as Record<string, string | null>);

    expect(names[docB] ?? null, "a foreign document's title must not resolve").toBeNull();
  });

  it("does not resolve names for an unauthenticated caller", async () => {
    const t = createTestContext();
    const { bob } = await setupTwoWorkspaces(t);

    const docB = await bob.asUser.mutation(api.documents.create, {
      workspaceId: bob.workspaceId,
      name: "Project Bluebird",
    });

    const names = await t
      .query(api.breadcrumb.getResourceNames, { resourceIds: [docB] })
      .catch(() => ({}) as Record<string, string | null>);

    expect(names[docB] ?? null).toBeNull();
  });
});

describe("workspaceInvites.accept — an ACCEPTED invite is a replayable credential", () => {
  it("cannot be replayed to rejoin after the member was removed", async () => {
    const t = createTestContext();
    const { alice } = await setupTwoWorkspaces(t);
    const carol = await setupAuthenticatedUser(t, {
      name: "Carol",
      email: "carol@a.test",
    });

    const inviteId = await alice.asUser.mutation(api.workspaceInvites.create, {
      workspaceId: alice.workspaceId,
      email: "carol@a.test",
    });

    await carol.asUser.mutation(api.workspaceInvites.accept, { inviteId });

    await alice.asUser.mutation(api.workspaceMembers.remove, {
      workspaceId: alice.workspaceId,
      targetUserId: carol.userId,
    });

    await expect(
      carol.asUser.mutation(api.workspaceInvites.accept, { inviteId }),
      // convex/workspaceInvites.ts:269 — invite.status is never read
    ).rejects.toThrow();

    const membership = await t.run(async (ctx) =>
      ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace_user", (q) =>
          q.eq("workspaceId", alice.workspaceId).eq("userId", carol.userId),
        )
        .first(),
    );

    expect(membership, "a removed member must not be able to re-enter").toBeNull();
  });

  it("marks the invite consumed so it cannot be re-presented", async () => {
    const t = createTestContext();
    const { alice } = await setupTwoWorkspaces(t);
    const carol = await setupAuthenticatedUser(t, {
      name: "Carol",
      email: "carol@a.test",
    });

    const inviteId = await alice.asUser.mutation(api.workspaceInvites.create, {
      workspaceId: alice.workspaceId,
      email: "carol@a.test",
    });
    await carol.asUser.mutation(api.workspaceInvites.accept, { inviteId });

    const invite = await t.run(async (ctx) => ctx.db.get(inviteId));

    expect(
      invite === null || invite.status !== InviteStatus.PENDING,
      "an accepted invite must be deleted or leave the PENDING state",
    ).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Shape 2b — endpoints with no authentication at all
   ══════════════════════════════════════════════════════════════════════ */

describe("unauthenticated public surface", () => {
  it("users.get does not hand out email or isPlatformAdmin", async () => {
    const t = createTestContext();
    const { bob } = await setupTwoWorkspaces(t);

    await t.run(async (ctx) => {
      await ctx.db.patch(bob.userId, { isPlatformAdmin: true });
    });

    const user = await t
      .query(api.users.get, { id: bob.userId })
      // convex/users.ts:20 — bare ctx.db.get returning the full userValidator
      .catch(() => null);

    expect(
      user?.email ?? null,
      "an unauthenticated caller must not read a user's email",
    ).toBeNull();
    expect(
      user?.isPlatformAdmin ?? null,
      "an unauthenticated caller must not learn who the platform admins are",
    ).toBeNull();
  });

  it("workspaces.get refuses an unauthenticated caller", async () => {
    const t = createTestContext();
    const { bob } = await setupTwoWorkspaces(t);

    const ws = await t
      .query(api.workspaces.get, { id: bob.workspaceId })
      // convex/workspaces.ts:65 — chains into users.get for the owner's email
      .catch(() => null);

    expect(ws, "workspace metadata must not be public").toBeNull();
  });

  it("workspaces.get refuses a member of a different workspace", async () => {
    const t = createTestContext();
    const { alice, bob } = await setupTwoWorkspaces(t);

    const ws = await alice.asUser
      .query(api.workspaces.get, { id: bob.workspaceId })
      .catch(() => null);

    expect(ws).toBeNull();
  });

  it("version.set is not part of the public API surface", async () => {
    // Asserted at the registration level rather than by calling it:
    // convex-test does not enforce the public/internal boundary, so a
    // `t.mutation` call would pass either way. The deployment does enforce it,
    // and this is the property the deployment checks.
    //
    // convex/version.ts:14 — it took no args and had no auth check, while
    // `version.get` is a live subscription for every connected client, so each
    // anonymous call prompted every user in every workspace to reload.
    const version = await import("../convex/version");
    expect(
      (version.set as unknown as { isInternal?: boolean }).isInternal,
    ).toBe(true);
    expect(
      (version.get as unknown as { isInternal?: boolean }).isInternal ?? false,
      "version.get stays public — the clients subscribe to it",
    ).toBe(false);
  });
});
