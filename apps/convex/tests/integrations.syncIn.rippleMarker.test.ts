import { describe, expect, it } from "vitest";
import { applyNormalizedEvent } from "../convex/integrations/core/syncIn";
import { appendRippleTaskMarker } from "../convex/integrations/core/rippleMarker";
import type { NormalizedIssueOpenedEvent } from "../convex/integrations/core/types";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { withTriggers } from "../convex/dbTriggers";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";

/**
 * Provenance-marker tests: prove the new `tryClaimByRippleMarker` path and
 * the gated bot-login echo guard together solve the GitLab-OAuth bug
 * ("manually-created issues by the OAuth user never sync") without
 * regressing the GitHub-App echo behavior.
 */
async function setupFixtures(
  t: ReturnType<typeof createTestContext>,
  opts: {
    provider: "github" | "gitlab";
    /** Simulate an OAuth install by setting oauthRefreshToken on the row. */
    oauth?: boolean;
    /** Bot login the integration records. */
    botLogin?: string;
  },
) {
  const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });

  const { linkDoc } = await t.run(async (ctx) => {
    await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Triage",
      color: "bg-amber-500",
      order: 0,
      isDefault: false,
      isCompleted: false,
      isTriage: true,
    });
    const botUserId = await ctx.db.insert("users", {
      name: "GitHub",
      isBot: true,
    });
    const integrationId = await ctx.db.insert("workspaceIntegrations", {
      workspaceId,
      botUserId,
      provider: opts.provider,
      externalAccountId: "install-rm",
      externalBotLogin: opts.botLogin,
      ...(opts.oauth
        ? {
            credentialToken: "fake-access",
            oauthRefreshToken: "fake-refresh",
            oauthExpiresAt: Date.now() + 60 * 60_000,
          }
        : {}),
    });
    const linkId = await ctx.db.insert("projectIntegrationLinks", {
      workspaceId,
      projectId,
      workspaceIntegrationId: integrationId,
      status: "active",
      pausedByBilling: false,
      externalRepoFullName:
        opts.provider === "gitlab" ? "marnec/repo" : "acme/web",
      externalRepoId: opts.provider === "gitlab" ? "82639628" : "R_kgDOACME",
    });
    const linkDoc = (await ctx.db.get(linkId))!;
    return { linkDoc };
  });

  return {
    workspaceId,
    projectId,
    link: linkDoc as Doc<"projectIntegrationLinks">,
  };
}

function makeOpenedEvent(
  overrides: Partial<NormalizedIssueOpenedEvent> = {},
): NormalizedIssueOpenedEvent {
  return {
    kind: "issue.opened",
    externalIssueId: "I_marker_test",
    issueNumber: 7,
    externalUpdatedAt: 1_700_000_000_000,
    title: "Page crashes",
    body: "Repro: open settings",
    url: "https://gitlab.com/marnec/repo/-/issues/7",
    externalAuthor: { login: "marnec", avatarUrl: "", url: "" },
    ...overrides,
  };
}

async function makeRippleTask(
  t: ReturnType<typeof createTestContext>,
  args: { projectId: Id<"projects">; workspaceId: Id<"workspaces">; title?: string },
): Promise<Id<"tasks">> {
  return t.run(async (ctx) => {
    const status = (
      await ctx.db
        .query("taskStatuses")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .first()
    )!;
    // We need a real creator user so the task passes its own schema.
    const creator = await ctx.db
      .query("users")
      .first();
    return withTriggers(ctx).db.insert("tasks", {
      projectId: args.projectId,
      workspaceId: args.workspaceId,
      title: args.title ?? "Outbound-originated task",
      statusId: status._id,
      priority: "medium",
      completed: false,
      creatorId: creator!._id,
    });
  });
}

describe("issue.opened — ripple marker claim", () => {
  it("claims an existing task when the body carries a matching marker (no duplicate created)", async () => {
    const t = createTestContext();
    const { workspaceId, projectId, link } = await setupFixtures(t, {
      provider: "gitlab",
      oauth: true,
      botLogin: "marnec",
    });
    const taskId = await makeRippleTask(t, { workspaceId, projectId });

    // The body the bounce-back webhook carries: what Ripple posted +
    // GitLab's preservation of the HTML comment.
    const body = appendRippleTaskMarker("seed body", taskId);
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeOpenedEvent({ body }), link }),
    );

    // No second task created.
    const tasks = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?._id).toBe(taskId);

    // The existing task picks up the issue link + ref.
    const linkRow = await t.run((ctx) =>
      ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_task", (q) => q.eq("taskId", taskId))
        .unique(),
    );
    expect(linkRow?.externalIssueId).toBe("I_marker_test");
    const claimed = await t.run((ctx) => ctx.db.get(taskId));
    expect(claimed?.externalRefs).toHaveLength(1);
    expect(claimed?.externalRefs?.[0]?.issueNumber).toBe(7);
  });

  it("falls through to create-task when the marker points at a task in a different project", async () => {
    const t = createTestContext();
    const { workspaceId, projectId, link } = await setupFixtures(t, {
      provider: "gitlab",
      oauth: true,
      botLogin: "marnec",
    });
    // Task in a SECOND project — a spoofed/stale marker shouldn't bind it.
    const otherProjectId = await setupProject(t, {
      workspaceId,
      creatorId: (await t.run((ctx) => ctx.db.query("users").first()))!._id,
    });
    // Seed a status on the other project (makeRippleTask looks one up).
    await t.run(async (ctx) => {
      await ctx.db.insert("taskStatuses", {
        projectId: otherProjectId,
        name: "Backlog",
        color: "bg-slate-500",
        order: 0,
        isDefault: true,
        isCompleted: false,
        isTriage: false,
      });
    });
    const strayTaskId = await makeRippleTask(t, {
      workspaceId,
      projectId: otherProjectId,
    });

    const body = appendRippleTaskMarker("seed", strayTaskId);
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeOpenedEvent({ body }), link }),
    );

    // The stray task is untouched; a fresh task lands in the right project.
    const strayLink = await t.run((ctx) =>
      ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_task", (q) => q.eq("taskId", strayTaskId))
        .unique(),
    );
    expect(strayLink).toBeNull();

    const tasksInTarget = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(tasksInTarget).toHaveLength(1);
  });

  it("OAuth install: a user-authored issue WITHOUT marker syncs as a new task (the bug fix)", async () => {
    const t = createTestContext();
    const { projectId, link } = await setupFixtures(t, {
      provider: "gitlab",
      oauth: true,
      // Bot login collides with the human user — the previous code dropped this.
      botLogin: "marnec",
    });

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeOpenedEvent({
          externalAuthor: { login: "marnec", avatarUrl: "", url: "" },
        }),
        link,
      }),
    );

    const tasks = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(tasks).toHaveLength(1);
  });

  it("GitHub App install: a bot-authored issue without marker is still suppressed (belt-and-suspenders preserved)", async () => {
    const t = createTestContext();
    const { projectId, link } = await setupFixtures(t, {
      provider: "github",
      oauth: false,
      botLogin: "ripple[bot]",
    });

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeOpenedEvent({
          externalAuthor: { login: "ripple[bot]", avatarUrl: "", url: "" },
        }),
        link,
      }),
    );

    const tasks = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(tasks).toHaveLength(0);
  });

  it("strips the marker from the seeded initialBodyMarkdown so it doesn't round-trip into the description", async () => {
    const t = createTestContext();
    const { projectId, link } = await setupFixtures(t, {
      provider: "gitlab",
      oauth: true,
      botLogin: "marnec",
    });

    // A user-authored issue whose body coincidentally carries a marker for a
    // task that doesn't exist yet — the claim falls through, a new task is
    // created, but the persisted body must NOT include the marker.
    const fakeMarker =
      "<!-- ripple-task: kh79nonexistenttaskxxxxxxxxxx -->";
    const body = `Real description text.\n\n${fakeMarker}`;

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeOpenedEvent({ body, externalIssueId: "I_strip_test" }),
        link,
      }),
    );

    const linkRow = await t.run((ctx) =>
      ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_link_externalIssueId", (q) =>
          q.eq("projectIntegrationLinkId", link._id).eq("externalIssueId", "I_strip_test"),
        )
        .unique(),
    );
    expect(linkRow?.initialBodyMarkdown).toBe("Real description text.");

    // And a task DID get created (the spoofed marker pointed at nothing, so
    // we fell through to the normal create path).
    const tasks = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(tasks).toHaveLength(1);
  });
});
