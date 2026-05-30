import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildGithubGateway,
  type InstallationRequester,
} from "../convex/integrations/github/outboundGateway";
import type { GithubResponse } from "../convex/integrations/github/client";
import { applyNormalizedEvent } from "../convex/integrations/core/syncIn";
import { enqueueIssueCreate } from "../convex/integrations/core/outboundDispatch";
import type { NormalizedIssueOpenedEvent } from "../convex/integrations/core/types";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { internal } from "../convex/_generated/api";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";

/* ------------------------------------------------------------------ */
/* 1. Gateway: POST /repos/{repo}/issues                               */
/* ------------------------------------------------------------------ */

type RequestArgs = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
};

function fakeClient(responder: (a: RequestArgs) => GithubResponse<unknown>) {
  const calls: RequestArgs[] = [];
  const client: InstallationRequester = {
    request: async <T,>(args: RequestArgs) => {
      calls.push(args);
      return responder(args) as GithubResponse<T>;
    },
  };
  return { client, calls };
}

describe("buildGithubGateway.createIssue", () => {
  it("POSTs title+body and extracts node id / number / author / updated_at", async () => {
    const ts = "2026-05-26T10:00:00Z";
    const { client, calls } = fakeClient(() => ({
      status: 201,
      body: {
        node_id: "I_kwDOnew",
        number: 7,
        updated_at: ts,
        user: {
          login: "ripple-app-dev[bot]",
          avatar_url: "https://avatars/bot.png",
          html_url: "https://github.com/apps/ripple-app-dev",
        },
      },
    }));

    const outcome = await buildGithubGateway(client).createIssue({
      projectRef: "acme/web",
      title: "Fix login",
      body: "",
    });

    expect(outcome).toEqual({
      kind: "success",
      meta: {
        externalIssueId: "I_kwDOnew",
        issueNumber: 7,
        externalUpdatedAt: Date.parse(ts),
        externalAuthor: {
          login: "ripple-app-dev[bot]",
          avatarUrl: "https://avatars/bot.png",
          url: "https://github.com/apps/ripple-app-dev",
        },
      },
    });
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/repos/acme/web/issues",
      body: { title: "Fix login", body: "" },
    });
  });

  it("treats a 2xx with no body as retryable (can't link it back)", async () => {
    const { client } = fakeClient(() => ({ status: 201 }));
    const outcome = await buildGithubGateway(client).createIssue({
      projectRef: "acme/web",
      title: "x",
      body: "",
    });
    expect(outcome.kind).toBe("retryable");
  });

  it("maps a 422 to permanent_fail and a 503 to retryable", async () => {
    const perm = await buildGithubGateway(
      fakeClient(() => ({ status: 422, errorMessage: "Validation failed" }))
        .client,
    ).createIssue({ projectRef: "acme/web", title: "x", body: "" });
    expect(perm).toMatchObject({ kind: "permanent_fail", httpStatus: 422 });

    const retry = await buildGithubGateway(
      fakeClient(() => ({ status: 503 })).client,
    ).createIssue({ projectRef: "acme/web", title: "x", body: "" });
    expect(retry.kind).toBe("retryable");
  });
});

/* ------------------------------------------------------------------ */
/* Shared convex-test fixtures                                         */
/* ------------------------------------------------------------------ */

async function setupOutboundFixtures(
  t: ReturnType<typeof createTestContext>,
  opts: { taskCompleted?: boolean; withLink?: boolean } = {},
) {
  const { taskCompleted = false, withLink = false } = opts;
  const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });

  return await t.run(async (ctx) => {
    const botUserId = await ctx.db.insert("users", { name: "GitHub" });
    await ctx.db.insert("workspaceIntegrations", {
      workspaceId,
      botUserId,
      provider: "github",
      externalAccountId: "install-1",
    });
    const projectLinkId = await ctx.db.insert("projectIntegrationLinks", {
      projectId,
      workspaceId,
      status: "active",
      pausedByBilling: false,
      externalRepoId: "R_kg1",
      externalRepoFullName: "acme/web",
    });
    const statusId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: taskCompleted ? "Done" : "Todo",
      color: "bg-gray-500",
      order: 0,
      isDefault: true,
      isCompleted: taskCompleted,
    });
    const taskId = await ctx.db.insert("tasks", {
      projectId,
      workspaceId,
      title: "Native task",
      statusId,
      priority: "medium",
      completed: taskCompleted,
      creatorId: userId,
    });
    if (withLink) {
      await ctx.db.insert("taskIntegrationLinks", {
        taskId,
        projectIntegrationLinkId: projectLinkId,
        externalIssueId: "I_existing",
        externalUpdatedAt: 1,
        externalAuthor: { login: "x", avatarUrl: "", url: "" },
        externalState: "open",
      });
    }
    return { workspaceId, projectId, projectLinkId, taskId };
  });
}

/* ------------------------------------------------------------------ */
/* 2. Recorder: recordIssueCreateSuccess                               */
/* ------------------------------------------------------------------ */

describe("recordIssueCreateSuccess", () => {
  const author = {
    login: "ripple-app-dev[bot]",
    avatarUrl: "https://a/bot.png",
    url: "https://github.com/apps/ripple-app-dev",
  };

  it("writes the link (open) and mirrors the issue ref onto the task", async () => {
    const t = createTestContext();
    const { projectLinkId, taskId } = await setupOutboundFixtures(t);

    await t.mutation(
      internal.integrations.core.syncOutMutations.recordIssueCreateSuccess,
      {
        taskId,
        projectIntegrationLinkId: projectLinkId,
        externalIssueId: "I_new",
        issueNumber: 99,
        externalUpdatedAt: 5_000,
        externalAuthor: author,
      },
    );

    const { link, task } = await t.run(async (ctx) => ({
      link: await ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_task", (q) => q.eq("taskId", taskId))
        .unique(),
      task: await ctx.db.get(taskId),
    }));

    expect(link?.externalIssueId).toBe("I_new");
    expect(link?.externalState).toBe("open");
    expect(task?.externalRefs?.[0]).toEqual({
      provider: "github",
      repoFullName: "acme/web",
      issueNumber: 99,
      url: "https://github.com/acme/web/issues/99",
    });
  });

  it("is a no-op when a link for that issue already exists (echo race)", async () => {
    const t = createTestContext();
    const { projectLinkId, taskId } = await setupOutboundFixtures(t);

    // A webhook beat the recorder and built the link on some other task.
    const otherTaskId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("tasks", {
        projectId: (await ctx.db.get(taskId))!.projectId,
        workspaceId: (await ctx.db.get(taskId))!.workspaceId,
        title: "Webhook task",
        statusId: (await ctx.db.get(taskId))!.statusId,
        priority: "medium",
        completed: false,
        creatorId: (await ctx.db.get(taskId))!.creatorId,
      });
      await ctx.db.insert("taskIntegrationLinks", {
        taskId: id,
        projectIntegrationLinkId: projectLinkId,
        externalIssueId: "I_dup",
        externalUpdatedAt: 1,
        externalAuthor: { login: "x", avatarUrl: "", url: "" },
        externalState: "open",
      });
      return id;
    });

    await t.mutation(
      internal.integrations.core.syncOutMutations.recordIssueCreateSuccess,
      {
        taskId,
        projectIntegrationLinkId: projectLinkId,
        externalIssueId: "I_dup",
        issueNumber: 1,
        externalUpdatedAt: 5_000,
        externalAuthor: author,
      },
    );

    const { ourLink, task } = await t.run(async (ctx) => ({
      ourLink: await ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_task", (q) => q.eq("taskId", taskId))
        .unique(),
      task: await ctx.db.get(taskId),
    }));
    expect(ourLink).toBeNull(); // no duplicate link created for our task
    expect(task?.externalRefs).toBeUndefined();
    expect(otherTaskId).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* 3. Dispatcher guards: enqueueIssueCreate                            */
/* ------------------------------------------------------------------ */

describe("enqueueIssueCreate guards", () => {
  it("throws for a completed task", async () => {
    const t = createTestContext();
    const { projectLinkId, taskId } = await setupOutboundFixtures(t, {
      taskCompleted: true,
    });
    await expect(
      t.run((ctx) =>
        enqueueIssueCreate(ctx, {
          taskId,
          projectIntegrationLinkId: projectLinkId,
          title: "x",
          body: "",
        }),
      ),
    ).rejects.toThrow(/completed/i);
  });

  it("throws when the task is already linked", async () => {
    const t = createTestContext();
    const { projectLinkId, taskId } = await setupOutboundFixtures(t, {
      withLink: true,
    });
    await expect(
      t.run((ctx) =>
        enqueueIssueCreate(ctx, {
          taskId,
          projectIntegrationLinkId: projectLinkId,
          title: "x",
          body: "",
        }),
      ),
    ).rejects.toThrow(/already linked/i);
  });

  it("throws when the repo link belongs to a different project", async () => {
    const t = createTestContext();
    const { taskId, workspaceId } = await setupOutboundFixtures(t);
    // A link for an unrelated project in the same workspace.
    const { userId } = await setupWorkspaceWithAdmin(t);
    const otherProjectId = await setupProject(t, {
      workspaceId,
      creatorId: userId,
    });
    const otherLinkId: Id<"projectIntegrationLinks"> = await t.run((ctx) =>
      ctx.db.insert("projectIntegrationLinks", {
        projectId: otherProjectId,
        workspaceId,
        status: "active",
        pausedByBilling: false,
        externalRepoId: "R_other",
        externalRepoFullName: "acme/other",
      }),
    );
    await expect(
      t.run((ctx) =>
        enqueueIssueCreate(ctx, {
          taskId,
          projectIntegrationLinkId: otherLinkId,
          title: "x",
          body: "",
        }),
      ),
    ).rejects.toThrow(/not connected to this task's project/i);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Inbound echo guard: suppress our own bot-authored issue.opened   */
/* ------------------------------------------------------------------ */

describe("issue.opened echo guard (self-authored)", () => {
  async function inboundFixtures(t: ReturnType<typeof createTestContext>) {
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });
    return await t.run(async (ctx) => {
      await ctx.db.insert("taskStatuses", {
        projectId,
        name: "Triage",
        color: "bg-amber-500",
        order: 0,
        isDefault: false,
        isCompleted: false,
        isTriage: true,
      });
      const botUserId = await ctx.db.insert("users", { name: "GitHub" });
      await ctx.db.insert("workspaceIntegrations", {
        workspaceId,
        botUserId,
        provider: "github",
        externalAccountId: "install-1",
        externalBotLogin: "ripple-app-dev[bot]",
      });
      const linkId = await ctx.db.insert("projectIntegrationLinks", {
        workspaceId,
        projectId,
        status: "active",
        pausedByBilling: false,
        externalRepoFullName: "acme/web",
        externalRepoId: "R_kg1",
      });
      return {
        projectId,
        link: (await ctx.db.get(linkId))! as Doc<"projectIntegrationLinks">,
      };
    });
  }

  const botEvent = (): NormalizedIssueOpenedEvent => ({
    kind: "issue.opened",
    externalIssueId: "I_self",
    issueNumber: 5,
    externalUpdatedAt: 1_700_000_000_000,
    title: "Created from Ripple",
    body: "",
    url: "https://github.com/acme/web/issues/5",
    externalAuthor: {
      login: "ripple-app-dev[bot]",
      avatarUrl: "",
      url: "",
    },
  });

  const countTasks = (t: ReturnType<typeof createTestContext>, pid: Id<"projects">) =>
    t.run(async (ctx) =>
      (
        await ctx.db
          .query("tasks")
          .withIndex("by_project", (q) => q.eq("projectId", pid))
          .collect()
      ).length,
    );

  it("suppresses a live bot-authored open with no existing link", async () => {
    const t = createTestContext();
    const { projectId, link } = await inboundFixtures(t);
    await t.run((ctx) => applyNormalizedEvent(ctx, { event: botEvent(), link }));
    expect(await countTasks(t, projectId)).toBe(0);
  });

  it("still ingests a bot-authored open during bulk import", async () => {
    const t = createTestContext();
    const { projectId, link } = await inboundFixtures(t);
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: botEvent(),
        link,
        importContext: { importJobId: undefined, taskNumber: 1 },
      }),
    );
    expect(await countTasks(t, projectId)).toBe(1);
  });

  it("does not suppress a human-authored open", async () => {
    const t = createTestContext();
    const { projectId, link } = await inboundFixtures(t);
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: { ...botEvent(), externalAuthor: { login: "alice", avatarUrl: "", url: "" } },
        link,
      }),
    );
    expect(await countTasks(t, projectId)).toBe(1);
  });
});
