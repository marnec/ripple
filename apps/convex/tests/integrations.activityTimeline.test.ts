import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { applyNormalizedEvent } from "../convex/integrations/core/syncIn";
import { applyPullRequestEvent } from "../convex/integrations/core/syncInPullRequests";
import type { NormalizedPullRequestChangedEvent } from "../convex/integrations/core/types";
import type { Doc, Id } from "../convex/_generated/dataModel";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";

const author = {
  login: "octocat",
  avatarUrl: "https://github.com/octocat.png",
  url: "https://github.com/octocat",
};

/**
 * Same fixture as the PR-lifecycle suite, but with a `setsStartDate` status so
 * that opening a PR actually moves the task (triage → In Progress) and thereby
 * exercises the `status_synced` activity entry.
 */
async function setup(t: ReturnType<typeof createTestContext>) {
  const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });
  const { link } = await t.run(async (ctx) => {
    await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Triage",
      color: "bg-amber-500",
      order: 0,
      isDefault: false,
      isCompleted: false,
      isTriage: true,
    });
    await ctx.db.insert("taskStatuses", {
      projectId,
      name: "In Progress",
      color: "bg-blue-500",
      order: 1,
      isDefault: true,
      isCompleted: false,
      isTriage: false,
      setsStartDate: true,
    });
    const botUserId = await ctx.db.insert("users", {
      name: "GitHub",
      isBot: true,
    });
    await ctx.db.insert("workspaceIntegrations", {
      workspaceId,
      botUserId,
      provider: "github",
      externalAccountId: "install-1",
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
      link: (await ctx.db.get(linkId))! as Doc<"projectIntegrationLinks">,
    };
  });
  return { workspaceId, projectId, link, asUser };
}

async function importIssue(
  t: ReturnType<typeof createTestContext>,
  link: Doc<"projectIntegrationLinks">,
  externalIssueId: string,
  issueNumber: number,
) {
  await t.run((ctx) =>
    applyNormalizedEvent(ctx, {
      event: {
        kind: "issue.opened",
        externalIssueId,
        issueNumber,
        externalUpdatedAt: 1_000,
        title: `Issue ${issueNumber}`,
        body: "",
        url: `https://github.com/acme/web/issues/${issueNumber}`,
        externalAuthor: author,
      },
      link,
    }),
  );
}

async function taskFor(
  t: ReturnType<typeof createTestContext>,
  link: Doc<"projectIntegrationLinks">,
  externalIssueId: string,
): Promise<Id<"tasks">> {
  return t.run(async (ctx) => {
    const tl = await ctx.db
      .query("taskIntegrationLinks")
      .withIndex("by_link_externalIssueId", (q) =>
        q
          .eq("projectIntegrationLinkId", link._id)
          .eq("externalIssueId", externalIssueId),
      )
      .unique();
    return tl!.taskId;
  });
}

function prEvent(
  overrides: Partial<NormalizedPullRequestChangedEvent> = {},
): NormalizedPullRequestChangedEvent {
  return {
    kind: "pullRequest.changed",
    externalPrId: "PR_1",
    number: 7,
    externalUpdatedAt: 2_000,
    title: "feat: fix it",
    url: "https://github.com/acme/web/pull/7",
    state: "open",
    headRef: "fix/it",
    baseRef: "main",
    externalAuthor: author,
    closesExternalIssueIds: ["I_1"],
    ...overrides,
  };
}

/** Activity-kind timeline rows for a task, via the public query. */
async function activity(
  asUser: Awaited<ReturnType<typeof setupWorkspaceWithAdmin>>["asUser"],
  taskId: Id<"tasks">,
) {
  const timeline = await asUser.query(api.taskActivity.timeline, { taskId });
  return timeline.filter((i) => i.kind === "activity");
}

describe("integration activity logging", () => {
  it("logs issue_linked (source: integration) when a task is imported", async () => {
    const t = createTestContext();
    const { link, asUser } = await setup(t);
    await importIssue(t, link, "I_1", 1);
    const taskId = await taskFor(t, link, "I_1");

    const entries = await activity(asUser, taskId);
    const linked = entries.find((e) => e.type === "issue_linked");
    expect(linked).toBeDefined();
    expect(linked?.source).toBe("integration");
    expect(linked?.newValue).toBe("#1");
  });

  it("logs pr_linked when a PR attaches, and pr_merged on merge", async () => {
    const t = createTestContext();
    const { link, asUser } = await setup(t);
    await importIssue(t, link, "I_1", 1);
    const taskId = await taskFor(t, link, "I_1");

    await t.run((ctx) => applyPullRequestEvent(ctx, { event: prEvent(), link }));
    let entries = await activity(asUser, taskId);
    const linked = entries.find((e) => e.type === "pr_linked");
    expect(linked?.source).toBe("integration");
    expect(linked?.newValue).toBe("#7 feat: fix it");

    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: prEvent({ state: "merged", externalUpdatedAt: 3_000 }),
        link,
      }),
    );
    entries = await activity(asUser, taskId);
    expect(entries.some((e) => e.type === "pr_merged")).toBe(true);
  });

  it("does not log draft↔open churn as a terminal transition", async () => {
    const t = createTestContext();
    const { link, asUser } = await setup(t);
    await importIssue(t, link, "I_1", 1);
    const taskId = await taskFor(t, link, "I_1");

    await t.run((ctx) => applyPullRequestEvent(ctx, { event: prEvent(), link }));
    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: prEvent({ state: "draft", externalUpdatedAt: 3_000 }),
        link,
      }),
    );

    const entries = await activity(asUser, taskId);
    expect(entries.some((e) => e.type === "pr_merged")).toBe(false);
    expect(entries.some((e) => e.type === "pr_closed")).toBe(false);
  });

  it("logs pr_unlinked when a closing reference is removed", async () => {
    const t = createTestContext();
    const { link, asUser } = await setup(t);
    await importIssue(t, link, "I_1", 1);
    const taskId = await taskFor(t, link, "I_1");

    await t.run((ctx) => applyPullRequestEvent(ctx, { event: prEvent(), link }));
    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: prEvent({ closesExternalIssueIds: [], externalUpdatedAt: 3_000 }),
        link,
      }),
    );

    const entries = await activity(asUser, taskId);
    expect(entries.some((e) => e.type === "pr_unlinked")).toBe(true);
  });

  it("logs status_synced when an opened PR advances the task's status", async () => {
    const t = createTestContext();
    const { link, asUser } = await setup(t);
    await importIssue(t, link, "I_1", 1);
    const taskId = await taskFor(t, link, "I_1");

    await t.run((ctx) => applyPullRequestEvent(ctx, { event: prEvent(), link }));

    const entries = await activity(asUser, taskId);
    const synced = entries.find((e) => e.type === "status_synced");
    expect(synced).toBeDefined();
    expect(synced?.source).toBe("integration");
    expect(synced?.oldValue).toBe("Triage");
    expect(synced?.newValue).toBe("In Progress");
  });
});
