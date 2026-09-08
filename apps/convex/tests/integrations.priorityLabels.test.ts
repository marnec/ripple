import { describe, expect, it } from "vitest";
import {
  splitPriorityLabels,
  withPriorityLabel,
} from "../convex/integrations/core/priorityLabels";

/**
 * Priority ↔ label sync (plan C). Priority labels are a vocabulary separate
 * from tags: `withPriorityLabel` adds the mapped label to an outbound label
 * set, `splitPriorityLabels` strips it from an inbound set and reports the
 * priority it stood for. A link without a map is a no-op in both directions.
 */
const MAP = { urgent: "p0", high: "p1", medium: "p2", low: "p3" };

describe("priorityLabels.withPriorityLabel", () => {
  it("adds the mapped label to the tags, normalized and deduped", () => {
    expect(withPriorityLabel(["Bug", "p3"], "low", MAP)).toEqual(["bug", "p3"]);
    expect(withPriorityLabel(["bug"], "urgent", MAP)).toEqual(["bug", "p0"]);
  });

  it("returns just the normalized tags when the link has no map", () => {
    expect(withPriorityLabel([" Bug "], "urgent", undefined)).toEqual(["bug"]);
  });

  it("never carries a stale priority label from the tags", () => {
    // A tag that happens to equal another slot's label is the router's
    // problem (validation forbids it); here we only assert the mapped one wins.
    expect(withPriorityLabel(["bug"], "high", MAP)).toEqual(["bug", "p1"]);
  });
});

describe("priorityLabels.splitPriorityLabels", () => {
  it("strips the mapped label and reports the priority it stood for", () => {
    expect(splitPriorityLabels(["Bug", "P1"], MAP)).toEqual({
      tags: ["bug"],
      priority: "high",
    });
  });

  it("leaves priority undefined when no mapped label is present", () => {
    expect(splitPriorityLabels(["bug"], MAP)).toEqual({ tags: ["bug"], priority: undefined });
  });

  it("picks the highest when several mapped labels are present, stripping all of them", () => {
    expect(splitPriorityLabels(["p3", "bug", "p1", "p2"], MAP)).toEqual({
      tags: ["bug"],
      priority: "high",
    });
  });

  it("is the identity on tags for a link without a map", () => {
    expect(splitPriorityLabels(["p1", "bug"], undefined)).toEqual({
      tags: ["p1", "bug"],
      priority: undefined,
    });
  });
});

// ── Outbound: priority changes swap the mapped label on the provider ────────

import { afterEach, beforeEach, vi } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { withTriggers } from "../convex/dbTriggers";

async function generateTestKeyPem(): Promise<string> {
  const keypair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", keypair.privateKey);
  const bytes = new Uint8Array(pkcs8);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

type WireCall = { method: string; url: string; body: Record<string, unknown> | undefined };

/** A provider that accepts everything and records every write it received. */
function stubProvider() {
  const calls: WireCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.includes("/access_tokens")) {
        return new Response(JSON.stringify({ token: "ghs_test" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (method !== "GET") {
        calls.push({
          method,
          url: u,
          body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
        });
        // Issue-create shape for both providers; label pushes ignore the body.
        return new Response(
          JSON.stringify({
            node_id: "I_created", number: 77, id: 301, iid: 77,
            web_url: "https://gitlab.com/acme/web/-/issues/77",
            updated_at: "2026-05-26T10:00:00Z",
            user: { login: "ripple[bot]", avatar_url: "", html_url: "" },
            author: { username: "bot", avatar_url: "", web_url: "" },
          }),
          { status: method === "POST" ? 201 : 200, headers: { "Content-Type": "application/json" } },
        );
      }
      // Marker precheck: nothing upstream.
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  return calls;
}

const MAP_STORED = { urgent: "p0", high: "p1", medium: "p2", low: "p3" };

async function linkedTask(
  t: ReturnType<typeof createTestContext>,
  opts: {
    provider: "github" | "gitlab";
    map?: typeof MAP_STORED;
    priority: "urgent" | "high" | "medium" | "low";
    tags: string[];
    /** Omit to leave the task unlinked (create-issue tests). */
    externalLabels?: string[];
  },
) {
  const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });
  const ids = await t.run(async (ctx) => {
    const botUserId = await ctx.db.insert("users", { name: "bot", isBot: true });
    await ctx.db.insert("workspaceIntegrations", {
      workspaceId, botUserId, provider: opts.provider, externalAccountId: "acct-1",
      ...(opts.provider === "gitlab" ? { credentialToken: "glpat-x" } : {}),
    });
    const projectLinkId = await ctx.db.insert("projectIntegrationLinks", {
      projectId, workspaceId, status: "active", pausedByBilling: false,
      externalRepoId: opts.provider === "gitlab" ? "42" : "R_kg1",
      externalRepoFullName: "acme/web",
      priorityLabels: opts.map,
    });
    const statusId = await ctx.db.insert("taskStatuses", {
      projectId, name: "Todo", color: "bg-gray-500", order: 0, isDefault: true, isCompleted: false,
    });
    const taskId = await withTriggers(ctx).db.insert("tasks", {
      projectId, workspaceId, title: "Prio task", statusId, priority: opts.priority,
      completed: false, creatorId: userId, tags: opts.tags,
      ...(opts.externalLabels
        ? { externalRefs: [{ provider: opts.provider, repoFullName: "acme/web", issueNumber: 42, url: "https://x/42" }] }
        : {}),
    });
    let linkId: Id<"taskIntegrationLinks"> | undefined;
    if (opts.externalLabels) {
      linkId = await ctx.db.insert("taskIntegrationLinks", {
        taskId, projectIntegrationLinkId: projectLinkId,
        externalIssueId: opts.provider === "gitlab" ? "301" : "I_kg1",
        externalUpdatedAt: 1_000, externalState: "open",
        externalAuthor: { login: "octocat", avatarUrl: "", url: "" },
        externalLabels: opts.externalLabels,
      });
    }
    return { taskId, projectLinkId, linkId };
  });
  return { asUser, ...ids };
}

const readLink = (t: ReturnType<typeof createTestContext>, taskId: Id<"tasks">) =>
  t.run((ctx) =>
    ctx.db.query("taskIntegrationLinks").withIndex("by_task", (q) => q.eq("taskId", taskId)).unique(),
  );
const readRuns = (t: ReturnType<typeof createTestContext>) =>
  t.run((ctx) => ctx.db.query("integrationOutboundRuns").collect());

describe("priority labels — outbound", () => {
  let savedAppId: string | undefined;
  let savedKey: string | undefined;
  beforeEach(async () => {
    vi.useFakeTimers();
    savedAppId = process.env.GITHUB_APP_ID;
    savedKey = process.env.GITHUB_APP_PRIVATE_KEY;
    process.env.GITHUB_APP_ID = "1";
    process.env.GITHUB_APP_PRIVATE_KEY = await generateTestKeyPem();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    if (savedAppId === undefined) delete process.env.GITHUB_APP_ID;
    else process.env.GITHUB_APP_ID = savedAppId;
    if (savedKey === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY;
    else process.env.GITHUB_APP_PRIVATE_KEY = savedKey;
  });

  it("GitHub: urgent→low enqueues one labels push adding the low label and removing the urgent one; tags untouched", async () => {
    const t = createTestContext();
    const { asUser, taskId } = await linkedTask(t, {
      provider: "github", map: MAP_STORED, priority: "urgent",
      tags: ["bug"], externalLabels: ["bug", "p0"],
    });
    const calls = stubProvider();

    await asUser.mutation(api.tasks.update, { taskId, priority: "low" });
    expect(await readRuns(t)).toHaveLength(1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(calls).toEqual([
      { method: "POST", url: expect.stringContaining("/repos/acme/web/issues/42/labels"), body: { labels: ["p3"] } },
      { method: "DELETE", url: expect.stringContaining("/repos/acme/web/issues/42/labels/p0"), body: undefined },
    ]);
    expect((await readLink(t, taskId))?.externalLabels).toEqual(["bug", "p3"]);
    expect((await t.run((ctx) => ctx.db.get(taskId)))?.tags).toEqual(["bug"]);
  });

  it("GitLab: the same change goes out as one PUT with add_labels/remove_labels", async () => {
    const t = createTestContext();
    const { asUser, taskId } = await linkedTask(t, {
      provider: "gitlab", map: MAP_STORED, priority: "urgent",
      tags: ["bug"], externalLabels: ["bug", "p0"],
    });
    const calls = stubProvider();

    await asUser.mutation(api.tasks.update, { taskId, priority: "low" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(calls).toEqual([
      { method: "PUT", url: expect.stringContaining("/issues/42"), body: { add_labels: "p3", remove_labels: "p0" } },
    ]);
    expect((await readLink(t, taskId))?.externalLabels).toEqual(["bug", "p3"]);
    expect((await t.run((ctx) => ctx.db.get(taskId)))?.tags).toEqual(["bug"]);
  });

  it("a tag edit pushes the tag change and leaves the priority label in place", async () => {
    const t = createTestContext();
    const { asUser, taskId } = await linkedTask(t, {
      provider: "github", map: MAP_STORED, priority: "urgent",
      tags: ["bug"], externalLabels: ["bug", "p0"],
    });
    const calls = stubProvider();

    await asUser.mutation(api.tasks.update, { taskId, tags: ["bug", "docs"] });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(calls).toEqual([
      { method: "POST", url: expect.stringContaining("/labels"), body: { labels: ["docs"] } },
    ]);
    expect((await readLink(t, taskId))?.externalLabels).toEqual(["bug", "docs", "p0"]);
    expect((await t.run((ctx) => ctx.db.get(taskId)))?.tags).toEqual(["bug", "docs"]);
  });

  it("creating an issue from a task sends its priority label with the tags; the link mirrors the sent set", async () => {
    const t = createTestContext();
    const { asUser, taskId, projectLinkId } = await linkedTask(t, {
      provider: "github", map: MAP_STORED, priority: "high", tags: ["bug"],
    });
    const calls = stubProvider();

    await asUser.mutation(api.tasks.createGithubIssue, {
      taskId, projectIntegrationLinkId: projectLinkId, title: "Prio task", body: "",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(calls).toHaveLength(1);
    expect(calls[0].body?.labels).toEqual(["bug", "p1"]);
    expect((await readLink(t, taskId))?.externalLabels).toEqual(["bug", "p1"]);
    expect((await t.run((ctx) => ctx.db.get(taskId)))?.tags).toEqual(["bug"]);
  });

  it("a link without a map: a priority change enqueues nothing", async () => {
    const t = createTestContext();
    const { asUser, taskId } = await linkedTask(t, {
      provider: "github", priority: "urgent", tags: ["bug"], externalLabels: ["bug"],
    });
    stubProvider();

    await asUser.mutation(api.tasks.update, { taskId, priority: "low" });

    expect(await readRuns(t)).toHaveLength(0);
  });
});

// ── Inbound: a mapped label on the provider drives the task's priority ──────

import { applyNormalizedEvent } from "../convex/integrations/core/syncIn";
import type {
  NormalizedIssueLabelsChangedEvent,
  NormalizedIssueOpenedEvent,
} from "../convex/integrations/core/types";

async function inboundFixtures(
  t: ReturnType<typeof createTestContext>,
  opts: { map?: typeof MAP_STORED } = {},
) {
  const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });
  const seeded = await t.run(async (ctx) => {
    await ctx.db.insert("taskStatuses", {
      projectId, name: "Triage", color: "bg-amber-500", order: 0,
      isDefault: false, isCompleted: false, isTriage: true,
    });
    const botUserId = await ctx.db.insert("users", { name: "GitHub", isBot: true });
    await ctx.db.insert("workspaceIntegrations", {
      workspaceId, botUserId, provider: "github", externalAccountId: "install-123",
    });
    const linkId = await ctx.db.insert("projectIntegrationLinks", {
      workspaceId, projectId, status: "active", pausedByBilling: false,
      externalRepoFullName: "acme/web", externalRepoId: "R_kgDOACME",
      priorityLabels: opts.map,
    });
    const link = (await ctx.db.get(linkId))!;
    return { workspaceId, projectId, botUserId, link };
  });
  return { ...seeded, asUser };
}

type AsUser = Awaited<ReturnType<typeof setupWorkspaceWithAdmin>>["asUser"];

function opened(overrides: Partial<NormalizedIssueOpenedEvent> = {}): NormalizedIssueOpenedEvent {
  return {
    kind: "issue.opened", externalIssueId: "I_1", issueNumber: 42,
    externalUpdatedAt: 1_000, title: "Inbound prio", body: "",
    url: "https://github.com/acme/web/issues/42",
    externalAuthor: { login: "octocat", avatarUrl: "", url: "" },
    ...overrides,
  };
}

function labelsChanged(labels: string[], externalUpdatedAt = 2_000): NormalizedIssueLabelsChangedEvent {
  return { kind: "issue.labels_changed", externalIssueId: "I_1", issueNumber: 42, externalUpdatedAt, labels };
}

async function taskState(
  t: ReturnType<typeof createTestContext>,
  projectId: Id<"projects">,
  asUser: AsUser,
) {
  const rows = await t.run(async (ctx) => {
    const [task] = await ctx.db.query("tasks").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect();
    const link = await ctx.db.query("taskIntegrationLinks").withIndex("by_task", (q) => q.eq("taskId", task._id)).unique();
    const joinTags = (
      await ctx.db.query("taskTags").withIndex("by_task", (q) => q.eq("taskId", task._id)).collect()
    ).map((r) => r.tagName).sort();
    return { task, link, joinTags };
  });
  // Through the public timeline, the way the task detail sees it.
  const timeline = await asUser.query(api.taskActivity.timeline, { taskId: rows.task._id });
  const priorityChanges = timeline.filter(
    (i) => i.kind === "activity" && i.type === "priority_change",
  );
  return { ...rows, priorityChanges };
}

describe("priority labels — inbound", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a labels-changed event with a mapped label sets the priority, logs a bot-attributed change, and keeps the label out of the tags", async () => {
    const t = createTestContext();
    const { projectId, botUserId, link, asUser } = await inboundFixtures(t, { map: MAP_STORED });
    await t.run((ctx) => applyNormalizedEvent(ctx, { event: opened(), link }));

    await t.run((ctx) => applyNormalizedEvent(ctx, { event: labelsChanged(["Bug", "P1"]), link }));

    const { task, link: taskLink, joinTags, priorityChanges } = await taskState(t, projectId, asUser);
    expect(task.priority).toBe("high");
    expect(task.tags).toEqual(["bug"]);
    expect(joinTags).toEqual(["bug"]);
    expect(taskLink?.externalLabels).toEqual(["bug", "p1"]);
    expect(priorityChanges).toHaveLength(1);
    expect(priorityChanges[0]).toMatchObject({
      userId: botUserId,
      source: "integration",
      oldValue: "medium",
      newValue: "high",
    });
  });

  it("an opened issue with a mapped label lands at that priority; without one it stays medium", async () => {
    const t = createTestContext();
    const { projectId, link, asUser } = await inboundFixtures(t, { map: MAP_STORED });

    await t.run((ctx) => applyNormalizedEvent(ctx, { event: opened({ labels: ["p0", "bug"] }), link }));
    const urgent = await taskState(t, projectId, asUser);
    expect(urgent.task.priority).toBe("urgent");
    expect(urgent.task.tags).toEqual(["bug"]);
    expect(urgent.joinTags).toEqual(["bug"]);
    expect(urgent.link?.externalLabels).toEqual(["p0", "bug"]);

    const t2 = createTestContext();
    const second = await inboundFixtures(t2, { map: MAP_STORED });
    await t2.run((ctx) =>
      applyNormalizedEvent(ctx, { event: opened({ labels: ["bug"] }), link: second.link }),
    );
    expect((await taskState(t2, second.projectId, second.asUser)).task.priority).toBe("medium");
  });

  it("several mapped labels at once resolve to the highest", async () => {
    const t = createTestContext();
    const { projectId, link, asUser } = await inboundFixtures(t, { map: MAP_STORED });
    await t.run((ctx) => applyNormalizedEvent(ctx, { event: opened(), link }));

    await t.run((ctx) => applyNormalizedEvent(ctx, { event: labelsChanged(["p3", "p1", "p2"]), link }));

    const { task } = await taskState(t, projectId, asUser);
    expect(task.priority).toBe("high");
    expect(task.tags).toEqual([]);
  });

  it("removing the mapped label upstream changes tags only; the priority stays", async () => {
    const t = createTestContext();
    const { projectId, link, asUser } = await inboundFixtures(t, { map: MAP_STORED });
    await t.run((ctx) => applyNormalizedEvent(ctx, { event: opened(), link }));
    await t.run((ctx) => applyNormalizedEvent(ctx, { event: labelsChanged(["bug", "p1"]), link }));

    await t.run((ctx) => applyNormalizedEvent(ctx, { event: labelsChanged(["bug", "docs"], 3_000), link }));

    const { task, link: taskLink, priorityChanges } = await taskState(t, projectId, asUser);
    expect(task.priority).toBe("high");
    expect(task.tags).toEqual(["bug", "docs"]);
    expect(taskLink?.externalLabels).toEqual(["bug", "docs"]);
    expect(priorityChanges).toHaveLength(1);
  });

  it("the echo guard drops the bounce-back of Ripple's own priority push (no second activity entry)", async () => {
    const t = createTestContext();
    const { projectId, link, asUser } = await inboundFixtures(t, { map: MAP_STORED });
    await t.run((ctx) => applyNormalizedEvent(ctx, { event: opened(), link }));
    await t.run((ctx) => applyNormalizedEvent(ctx, { event: labelsChanged(["bug", "p1"]), link }));
    // The outbound push from ticket 07 has just recorded this full set.
    const { link: before } = await taskState(t, projectId, asUser);
    await t.run((ctx) => ctx.db.patch(before!._id, { externalLabels: ["bug", "p3"] }));
    await t.run(async (ctx) => {
      const [task] = await ctx.db.query("tasks").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect();
      await ctx.db.patch(task._id, { priority: "low" });
    });

    await t.run((ctx) => applyNormalizedEvent(ctx, { event: labelsChanged(["p3", "bug"], 4_000), link }));

    const { task, priorityChanges } = await taskState(t, projectId, asUser);
    expect(task.priority).toBe("low");
    expect(priorityChanges).toHaveLength(1);
  });

  it("links without a map: a label that would be a priority elsewhere is just a tag, and the priority never moves", async () => {
    const t = createTestContext();
    const { projectId, link, asUser } = await inboundFixtures(t);
    await t.run((ctx) => applyNormalizedEvent(ctx, { event: opened({ labels: ["p0"] }), link }));

    await t.run((ctx) => applyNormalizedEvent(ctx, { event: labelsChanged(["p0", "p1"]), link }));

    const { task, joinTags, priorityChanges } = await taskState(t, projectId, asUser);
    expect(task.priority).toBe("medium");
    expect(task.tags).toEqual(["p0", "p1"]);
    expect(joinTags).toEqual(["p0", "p1"]);
    expect(priorityChanges).toHaveLength(0);
  });
});
