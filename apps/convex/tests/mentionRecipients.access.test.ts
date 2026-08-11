import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";

/**
 * Mentions in documents, task descriptions and task comments follow the
 * *workspace* rule — the same rule that governs the resources themselves.
 *
 * A mention is a push notification carrying the resource's name, sent to a user
 * id the caller supplied. Nothing downstream of `notify` re-checks access:
 * `deliverPush` filters the list by each recipient's own preferences and sends.
 * So an un-narrowed list pushes a document name or task title to any account in
 * the deployment, named by id from a workspace it has nothing to do with.
 */

type TestContext = ReturnType<typeof createTestContext>;

/** A user belonging to no workspace of the caller's. */
async function setupStranger(t: TestContext) {
  return setupAuthenticatedUser(t, {
    name: "Stranger",
    email: "stranger@example.com",
  });
}

/** A genuine member of the caller's workspace. */
async function setupColleague(t: TestContext, workspaceId: Id<"workspaces">) {
  const { userId, asUser } = await setupAuthenticatedUser(t, {
    name: "Colleague",
    email: "colleague@example.com",
  });
  await t.run((ctx) =>
    ctx.db.insert("workspaceMembers", {
      userId,
      workspaceId,
      role: WorkspaceRole.MEMBER,
    }),
  );
  return { userId, asUser };
}

async function setupDocument(
  t: TestContext,
  workspaceId: Id<"workspaces">,
  name = "Compensation plan",
) {
  return t.run((ctx) => ctx.db.insert("documents", { workspaceId, name }));
}

/** Recipients of every `deliverPush` queued so far, flattened. */
async function pushRecipients(t: TestContext): Promise<string[]> {
  const rows = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  return rows
    .filter((r) => String(r.name ?? "").includes("deliverPush"))
    .flatMap(
      (r) =>
        ((r.args as unknown[])[0] as { recipientIds?: string[] }).recipientIds ??
        [],
    );
}

async function setupTask(
  t: TestContext,
  opts: {
    workspaceId: Id<"workspaces">;
    creatorId: Id<"users">;
    title?: string;
  },
) {
  const projectId = await setupProject(t, {
    workspaceId: opts.workspaceId,
    creatorId: opts.creatorId,
  });
  return t.run(async (ctx) => {
    const statusId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "To Do",
      color: "bg-gray-500",
      order: 0,
      isDefault: true,
      isCompleted: false,
    });
    return ctx.db.insert("tasks", {
      projectId,
      workspaceId: opts.workspaceId,
      title: opts.title ?? "Rotate the production keys",
      statusId,
      priority: "medium" as const,
      completed: false,
      creatorId: opts.creatorId,
    });
  });
}

/** A BlockNote body carrying `@` mentions of the given user ids. */
function bodyMentioning(userIds: Id<"users">[], text = "take a look"): string {
  return JSON.stringify([
    {
      type: "paragraph",
      content: [
        ...userIds.map((userId) => ({ type: "userMention", props: { userId } })),
        { type: "text", text: ` ${text}`, styles: {} },
      ],
    },
  ]);
}

describe("mention recipients follow the workspace rule", () => {
  it("documents.reportMention drops a mention of a non-member", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const documentId = await setupDocument(t, workspaceId);
    const { userId: strangerId } = await setupStranger(t);

    await asUser.mutation(api.documents.reportMention, {
      documentId,
      mentionedUserIds: [strangerId],
    });

    expect(await pushRecipients(t)).not.toContain(strangerId);
  });

  it("taskComments.create drops a mention of a non-member", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const taskId = await setupTask(t, { workspaceId, creatorId: userId });
    const { userId: strangerId } = await setupStranger(t);

    await asUser.mutation(api.taskComments.create, {
      taskId,
      body: bodyMentioning([strangerId]),
      bodyMarkdown: "@Stranger take a look",
    });

    expect(await pushRecipients(t)).not.toContain(strangerId);
  });

  it("taskComments.update drops a mention of a non-member added on edit", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const taskId = await setupTask(t, { workspaceId, creatorId: userId });
    const { userId: strangerId } = await setupStranger(t);

    const commentId = await asUser.mutation(api.taskComments.create, {
      taskId,
      body: bodyMentioning([], "no mentions yet"),
      bodyMarkdown: "no mentions yet",
    });

    await asUser.mutation(api.taskComments.update, {
      id: commentId,
      body: bodyMentioning([strangerId]),
      bodyMarkdown: "@Stranger take a look",
    });

    expect(await pushRecipients(t)).not.toContain(strangerId);
  });

  it("tasks.notifyDescriptionMentions drops a mention of a non-member", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const taskId = await setupTask(t, { workspaceId, creatorId: userId });
    const { userId: strangerId } = await setupStranger(t);

    await asUser.mutation(api.tasks.notifyDescriptionMentions, {
      taskId,
      mentionedUserIds: [strangerId],
    });

    expect(await pushRecipients(t)).not.toContain(strangerId);
  });

  it("still notifies a colleague named through an arg-supplied list", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const documentId = await setupDocument(t, workspaceId);
    const { userId: colleagueId } = await setupColleague(t, workspaceId);

    await asUser.mutation(api.documents.reportMention, {
      documentId,
      mentionedUserIds: [colleagueId, userId],
    });

    expect(await pushRecipients(t)).toContain(colleagueId);
  });

  it("still notifies a colleague named inside a comment body", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const taskId = await setupTask(t, { workspaceId, creatorId: userId });
    const { userId: colleagueId } = await setupColleague(t, workspaceId);

    await asUser.mutation(api.taskComments.create, {
      taskId,
      body: bodyMentioning([colleagueId]),
      bodyMarkdown: "@Colleague take a look",
    });

    expect(await pushRecipients(t)).toContain(colleagueId);
  });
});
