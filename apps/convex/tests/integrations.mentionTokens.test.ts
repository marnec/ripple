import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import {
  MENTION_TOKEN_RE,
  renderMentionTokens,
} from "../convex/integrations/core/mentionTokens";
import { api } from "../convex/_generated/api";
import { createTestContext, setupProject, setupWorkspaceWithAdmin } from "./helpers";

/**
 * Outbound markdown is rendered in the browser, where a mention has no idea
 * what login the person has on the provider. So the editor emits a stable
 * token (`@user:<id>`, `@event:<id>`, `@series:<id>`) and the dispatch layer,
 * which knows workspace + provider, rewrites it just before enqueueing.
 * Linear's behaviour is the reference: a connected member becomes a real
 * `@login`, anyone else becomes their plain display name.
 */
async function member(
  t: ReturnType<typeof createTestContext>,
  workspaceId: Awaited<ReturnType<typeof setupWorkspaceWithAdmin>>["workspaceId"],
  fields: { name?: string; githubLogin?: string; gitlabLogin?: string; gitlabUserId?: string },
) {
  return t.run(async (ctx) => {
    const uid = await ctx.db.insert("users", fields);
    await ctx.db.insert("workspaceMembers", {
      userId: uid,
      workspaceId,
      role: WorkspaceRole.MEMBER,
    });
    return uid;
  });
}

describe("mentionTokens.renderMentionTokens — users", () => {
  it("renders a connected GitHub member as a real @login", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const marco = await member(t, workspaceId, { name: "Marco", githubLogin: "marco-login" });

    const out = await t.run((ctx) =>
      renderMentionTokens(ctx, `ping @user:${marco} about this`, {
        workspaceId,
        provider: "github",
      }),
    );

    expect(out).toBe("ping @marco-login about this");
    expect(out).not.toMatch(MENTION_TOKEN_RE);
  });
});

describe("mentionTokens.renderMentionTokens — fallbacks", () => {
  it("renders an unconnected member as their display name, without an @", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const marco = await member(t, workspaceId, { name: "Marco" });

    const out = await t.run((ctx) =>
      renderMentionTokens(ctx, `ping @user:${marco}`, { workspaceId, provider: "github" }),
    );
    expect(out).toBe("ping Marco");
  });

  it("does not @-mention someone who has a login but is not a member of this workspace", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const outsider = await t.run((ctx) =>
      ctx.db.insert("users", { name: "Outsider", githubLogin: "outsider-login" }),
    );

    const out = await t.run((ctx) =>
      renderMentionTokens(ctx, `cc @user:${outsider}`, { workspaceId, provider: "github" }),
    );
    expect(out).toBe("cc Outsider");
  });

  it("renders an unknown or malformed user id as a visible unknown-user marker", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const gone = await member(t, workspaceId, { name: "Gone" });
    await t.run((ctx) => ctx.db.delete(gone));

    const out = await t.run((ctx) =>
      renderMentionTokens(ctx, `@user:${gone} and @user:notanid`, { workspaceId, provider: "github" }),
    );
    expect(out).toBe("@unknown-user and @unknown-user");
  });

  it("mentions a GitLab member by username, not by the GitHub login", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const both = await member(t, workspaceId, {
      name: "Both",
      githubLogin: "both-gh",
      gitlabUserId: "42",
      gitlabLogin: "both-gl",
    });
    const onlyGithub = await member(t, workspaceId, { name: "Hub", githubLogin: "hub" });

    const out = await t.run((ctx) =>
      renderMentionTokens(ctx, `@user:${both} @user:${onlyGithub}`, {
        workspaceId,
        provider: "gitlab",
      }),
    );
    expect(out).toBe("@both-gl Hub");
  });

  it("prefers the per-workspace override, like the assignee matcher", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const marco = await member(t, workspaceId, { name: "Marco", githubLogin: "personal" });
    await t.run((ctx) =>
      ctx.db.insert("workspaceMemberExternalIdentity", {
        workspaceId,
        userId: marco,
        provider: "github",
        externalLogin: "work-login",
      }),
    );

    const out = await t.run((ctx) =>
      renderMentionTokens(ctx, `@user:${marco}`, { workspaceId, provider: "github" }),
    );
    expect(out).toBe("@work-login");
  });
});

describe("mentionTokens.renderMentionTokens — events", () => {
  it("renders event and series mentions as their titles", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
    const { eventId, seriesId } = await t.run(async (ctx) => {
      const eventId = await ctx.db.insert("calendarEvents", {
        workspaceId,
        title: "Design review",
        startsAt: 1,
        endsAt: 2,
        timezone: "UTC",
        createdBy: userId,
      });
      const seriesId = await ctx.db.insert("eventSeries", {
        workspaceId,
        title: "Daily standup",
        anchorDate: "2026-01-05",
        anchorTime: "09:00",
        durationMs: 900_000,
        timezone: "UTC",
        rule: { freq: "daily", interval: 1, end: { kind: "never" } },
        createdBy: userId,
        activeUntil: Number.MAX_SAFE_INTEGER,
      });
      return { eventId, seriesId };
    });

    const out = await t.run((ctx) =>
      renderMentionTokens(ctx, `see @event:${eventId} and @series:${seriesId}`, {
        workspaceId,
        provider: "github",
      }),
    );
    expect(out).toBe("see Design review and Daily standup");
  });

  it("renders a missing event or series as a visible unknown-event marker", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const out = await t.run((ctx) =>
      renderMentionTokens(ctx, `@event:nope @series:nope`, { workspaceId, provider: "github" }),
    );
    expect(out).toBe("unknown event unknown event");
  });
});

describe("mentionTokens grammar", () => {
  it("leaves ordinary text, emails and unknown token kinds untouched", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const body = "mail me@example.com, see @task:abc and @octocat";
    const out = await t.run((ctx) =>
      renderMentionTokens(ctx, body, { workspaceId, provider: "github" }),
    );
    expect(out).toBe(body);
  });

  it("matches only the three kinds and an alphanumeric id body", () => {
    const re = new RegExp(MENTION_TOKEN_RE.source);
    expect("@user:k17abc".match(re)?.[0]).toBe("@user:k17abc");
    expect("@event:k17abc".match(re)?.[0]).toBe("@event:k17abc");
    expect("@series:k17abc".match(re)?.[0]).toBe("@series:k17abc");
    expect("@task:k17abc".match(re)).toBeNull();
    expect("@user:".match(re)).toBeNull();
    // Stops at anything outside the id alphabet, so trailing prose survives.
    expect("@user:k17abc, thanks".match(re)?.[0]).toBe("@user:k17abc");
  });
});

/**
 * The three push sites that carry client-rendered markdown — comment create,
 * comment edit, description sync — must all rewrite tokens before enqueueing.
 * The retrier runs the real action, so the body is observed on the wire: a
 * stubbed GitHub transport records every write it receives.
 */
describe("outbound dispatch renders mention tokens", () => {
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

  /** A GitHub that accepts every write and remembers what it was sent. */
  function stubGithub() {
    const writes: { method: string; url: string; body: string }[] = [];
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
          writes.push({ method, url: u, body: String(init?.body ?? "") });
          return new Response(
            JSON.stringify({
              id: 2,
              updated_at: "2026-05-22T11:00:00Z",
              user: { login: "ripple[bot]", avatar_url: "", html_url: "" },
            }),
            { status: method === "POST" ? 201 : 200, headers: { "Content-Type": "application/json" } },
          );
        }
        // Comment scans and reads: nothing upstream.
        return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      }),
    );
    return writes;
  }

  async function linkedTask(t: ReturnType<typeof createTestContext>) {
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });
    const marco = await member(t, workspaceId, { name: "Marco", githubLogin: "marco-login" });
    const nora = await member(t, workspaceId, { name: "Nora" });
    const { taskId, taskLinkId } = await t.run(async (ctx) => {
      const statusId = await ctx.db.insert("taskStatuses", {
        projectId, name: "Todo", color: "bg-gray-500", order: 0, isDefault: true, isCompleted: false,
      });
      const botUserId = await ctx.db.insert("users", { name: "GitHub", isBot: true });
      await ctx.db.insert("workspaceIntegrations", {
        workspaceId, botUserId, provider: "github", externalAccountId: "install-1",
      });
      const projectLinkId = await ctx.db.insert("projectIntegrationLinks", {
        workspaceId, projectId, status: "active", pausedByBilling: false,
        externalRepoFullName: "acme/web", externalRepoId: "R_kgDOACME",
      });
      const taskId = await ctx.db.insert("tasks", {
        projectId, workspaceId, title: "task", statusId, priority: "medium",
        completed: false, creatorId: userId,
        externalRefs: [{ provider: "github", repoFullName: "acme/web", issueNumber: 42, url: "https://github.com/acme/web/issues/42" }],
      });
      const taskLinkId = await ctx.db.insert("taskIntegrationLinks", {
        taskId, projectIntegrationLinkId: projectLinkId, externalIssueId: "I_kwDOABC123",
        externalUpdatedAt: 1_700_000_000_000,
        externalAuthor: { login: "octocat", avatarUrl: "u", url: "https://github.com/octocat" },
      });
      return { taskId, taskLinkId };
    });
    return { asUser, userId, workspaceId, taskId, taskLinkId, marco, nora };
  }

  it("comment create: connected member → @login, unconnected → name, no token leaves", async () => {
    const t = createTestContext();
    const { asUser, taskId, marco, nora } = await linkedTask(t);
    const writes = stubGithub();

    await asUser.mutation(api.taskComments.create, {
      taskId,
      body: "[]",
      bodyMarkdown: `ping @user:${marco} and @user:${nora}`,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(writes).toHaveLength(1);
    const sent = JSON.parse(writes[0].body) as { body: string };
    expect(sent.body).toContain("ping @marco-login and Nora");
    expect(sent.body).not.toMatch(MENTION_TOKEN_RE);
  });

  it("comment edit renders the same way", async () => {
    const t = createTestContext();
    const { asUser, userId, taskId, taskLinkId, marco } = await linkedTask(t);
    // Authored by the caller: only the author may edit.
    const commentId = await t.run((ctx) =>
      ctx.db.insert("taskComments", { taskId, userId, body: "[]", deleted: false }),
    );
    await t.run((ctx) =>
      ctx.db.insert("taskCommentIntegrationLinks", {
        taskCommentId: commentId,
        taskIntegrationLinkId: taskLinkId,
        externalCommentId: "9001",
        externalUpdatedAt: 1_700_000_000_000,
      }),
    );
    const writes = stubGithub();

    await asUser.mutation(api.taskComments.update, {
      id: commentId,
      body: "[]",
      bodyMarkdown: `edited, cc @user:${marco}`,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(writes).toHaveLength(1);
    const sent = JSON.parse(writes[0].body) as { body: string };
    expect(sent.body).toBe("edited, cc @marco-login");
  });

  it("description sync renders the same way", async () => {
    const t = createTestContext();
    const { asUser, taskId, marco } = await linkedTask(t);
    const writes = stubGithub();

    await asUser.mutation(api.tasks.syncDescriptionToGitHub, {
      taskId,
      markdown: `# Spec\n\nowner: @user:${marco}`,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(writes).toHaveLength(1);
    const sent = JSON.parse(writes[0].body) as { body: string };
    expect(sent.body).toContain("owner: @marco-login");
    expect(sent.body).not.toMatch(MENTION_TOKEN_RE);
  });
});

/** Generate a throwaway RSA PEM so the action's App JWT signing succeeds. */
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
