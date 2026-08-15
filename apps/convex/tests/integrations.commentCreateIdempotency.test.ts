/**
 * Sweep-b #14 — a retried comment-create must not post a second comment.
 *
 * `createComment` is the one non-idempotent POST in the outbound surface that
 * shipped without the guard `createIssue` has. The action runs under the
 * action-retrier (`maxFailures: 4`), and `github/client.ts` maps a fetch
 * exception to `status: null` → retry — so a POST that commits and then loses
 * its response is simply re-POSTed. The duplicate lands on the customer's issue
 * tracker and is beyond Ripple's reach: only the last attempt's id reaches
 * `taskCommentIntegrationLinks`, so the earlier ones have no link row and the
 * edit and delete pushes cannot see them.
 *
 * Driven through the real action with a stubbed transport, because the defect
 * was never in the runner (which has always honoured `precheck`) nor in the
 * gateway — it was that `pushCommentCreate` did not pass one. Only running the
 * action can tell those apart.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { withTriggers } from "../convex/dbTriggers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Generate a throwaway RSA PEM so the action's JWT signing succeeds. */
async function generateTestKeyPem(): Promise<string> {
  const keypair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
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

/** A linked task with one Ripple comment waiting to be mirrored. */
async function setupLinkedComment(t: ReturnType<typeof createTestContext>) {
  const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });
  const seeded = await t.run(async (ctx) => {
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
    const statusId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Todo",
      color: "bg-gray-500",
      order: 0,
      isDefault: true,
      isCompleted: false,
    });
    const projectLinkId = await ctx.db.insert("projectIntegrationLinks", {
      workspaceId,
      projectId,
      status: "active",
      pausedByBilling: false,
      externalRepoFullName: "acme/web",
      externalRepoId: "R_kgDOACME",
    });
    const taskId = await withTriggers(ctx).db.insert("tasks", {
      projectId,
      workspaceId,
      title: "Linked task",
      statusId,
      priority: "medium",
      completed: false,
      creatorId: userId,
    });
    const taskIntegrationLinkId = await ctx.db.insert("taskIntegrationLinks", {
      taskId,
      projectIntegrationLinkId: projectLinkId,
      externalIssueId: "I_1",
      externalState: "open",
      externalUpdatedAt: 1_000,
      externalAuthor: {
        login: "octocat",
        avatarUrl: "https://github.com/octocat.png",
        url: "https://github.com/octocat",
      },
    });
    const commentId = await ctx.db.insert("taskComments", {
      taskId,
      userId,
      body: "[]",
      deleted: false,
    });
    return { commentId, taskIntegrationLinkId, taskId };
  });
  return { ...seeded, asUser };
}

describe("comment-create is idempotent under retry", () => {
  let savedAppId: string | undefined;
  let savedKey: string | undefined;

  beforeEach(async () => {
    savedAppId = process.env.GITHUB_APP_ID;
    savedKey = process.env.GITHUB_APP_PRIVATE_KEY;
    process.env.GITHUB_APP_ID = "1";
    process.env.GITHUB_APP_PRIVATE_KEY = await generateTestKeyPem();
  });
  afterEach(() => {
    if (savedAppId === undefined) delete process.env.GITHUB_APP_ID;
    else process.env.GITHUB_APP_ID = savedAppId;
    if (savedKey === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY;
    else process.env.GITHUB_APP_PRIVATE_KEY = savedKey;
  });

  /**
   * The retry that already happened. The previous attempt's POST committed and
   * its response was lost, so the marker is already on a comment upstream; this
   * attempt must adopt it rather than post again.
   */
  it("adopts the comment a lost attempt already posted instead of posting again", async () => {
    const t = createTestContext();
    const { commentId, taskIntegrationLinkId } = await setupLinkedComment(t);
    const body = `Looks good.\n\n<!-- ripple-comment: ${commentId} -->`;

    const posts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const u = String(url);
        if (u.includes("/access_tokens")) {
          return new Response(JSON.stringify({ token: "ghs_test" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if ((init?.method ?? "GET") === "POST") {
          posts.push(u);
          return new Response(JSON.stringify({ id: 2, updated_at: "2026-05-22T11:00:00Z", user: { login: "b", avatar_url: "", html_url: "" } }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }
        // The repo-level comment scan: the lost attempt's comment is here.
        return new Response(
          JSON.stringify([
            {
              id: 9001,
              body,
              updated_at: "2026-05-22T10:00:00Z",
              issue_url: "https://api.github.com/repos/acme/web/issues/42",
              user: {
                login: "ripple[bot]",
                avatar_url: "https://avatars/bot.png",
                html_url: "https://github.com/apps/ripple",
              },
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    await t.action(
      internal.integrations.github.syncOutAction.pushCommentCreate,
      {
        commentId,
        body,
        taskIntegrationLinkId,
        credentialRef: "install-1",
        projectRef: "acme/web",
        issueRef: 42,
      },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // No second comment on the customer's issue tracker …
    expect(posts).toEqual([]);
    // … and the mirror points at the one that is actually there.
    const links = await t.run((ctx) =>
      ctx.db.query("taskCommentIntegrationLinks").collect(),
    );
    expect(links).toHaveLength(1);
    expect(links[0].externalCommentId).toBe("9001");
  });

  /**
   * The ordinary first attempt. A lookup that finds nothing must not stop the
   * create — and neither must a lookup that fails, since refusing to post
   * because the *search* is degraded is a worse failure than the duplicate it
   * would prevent.
   */
  it("still posts when no marker is upstream, and when the scan itself fails", async () => {
    for (const scanStatus of [200, 403]) {
      const t = createTestContext();
      const { commentId, taskIntegrationLinkId } = await setupLinkedComment(t);

      const posts: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string | URL, init?: RequestInit) => {
          const u = String(url);
          if (u.includes("/access_tokens")) {
            return new Response(JSON.stringify({ token: "ghs_test" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if ((init?.method ?? "GET") === "POST") {
            posts.push(u);
            return new Response(
              JSON.stringify({
                id: 7,
                updated_at: "2026-05-22T11:00:00Z",
                user: { login: "b", avatar_url: "", html_url: "" },
              }),
              { status: 201, headers: { "Content-Type": "application/json" } },
            );
          }
          return new Response(scanStatus === 200 ? "[]" : "rate limited", {
            status: scanStatus,
            headers: { "Content-Type": "application/json" },
          });
        }),
      );

      await t.action(
        internal.integrations.github.syncOutAction.pushCommentCreate,
        {
          commentId,
          body: `hi\n\n<!-- ripple-comment: ${commentId} -->`,
          taskIntegrationLinkId,
          credentialRef: "install-1",
          projectRef: "acme/web",
          issueRef: 42,
        },
      );
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      expect(posts, `scan status ${scanStatus}`).toHaveLength(1);
      const links = await t.run((ctx) =>
        ctx.db.query("taskCommentIntegrationLinks").collect(),
      );
      expect(links[0]?.externalCommentId, `scan status ${scanStatus}`).toBe("7");
    }
  });
});

/**
 * The other half of the guard: the lookup can only find a comment that was
 * tagged on the way out. Driven from the public mutation an author actually
 * calls, because that is the only place the outbound body is assembled.
 */
describe("outbound comment bodies carry the marker the guard matches on", () => {
  let savedAppId: string | undefined;
  let savedKey: string | undefined;

  beforeEach(async () => {
    savedAppId = process.env.GITHUB_APP_ID;
    savedKey = process.env.GITHUB_APP_PRIVATE_KEY;
    process.env.GITHUB_APP_ID = "1";
    process.env.GITHUB_APP_PRIVATE_KEY = await generateTestKeyPem();
  });
  afterEach(() => {
    if (savedAppId === undefined) delete process.env.GITHUB_APP_ID;
    else process.env.GITHUB_APP_ID = savedAppId;
    if (savedKey === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY;
    else process.env.GITHUB_APP_PRIVATE_KEY = savedKey;
  });

  it("tags the pushed comment with its Ripple comment id", async () => {
    const t = createTestContext();
    const { taskId, asUser, commentId: seeded } = await setupLinkedComment(t);
    // The helper seeds a comment row for the action-level tests; drop it so
    // the one this test creates is the only one.
    await t.run((ctx) => ctx.db.delete(seeded));

    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const u = String(url);
        if (u.includes("/access_tokens")) {
          return new Response(JSON.stringify({ token: "ghs_test" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if ((init?.method ?? "GET") === "POST" && u.includes("/comments")) {
          bodies.push(String(init?.body ?? ""));
          return new Response(
            JSON.stringify({
              id: 7,
              updated_at: "2026-05-22T11:00:00Z",
              user: { login: "b", avatar_url: "", html_url: "" },
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("[]", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    await asUser.mutation(api.taskComments.create, {
      taskId,
      body: JSON.stringify([
        { type: "paragraph", content: [{ type: "text", text: "Looks good." }] },
      ]),
      bodyMarkdown: "Looks good.",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(bodies).toHaveLength(1);
    const commentId = await t.run(async (ctx) => {
      const c = await ctx.db.query("taskComments").first();
      return c!._id;
    });
    expect(bodies[0]).toContain(`<!-- ripple-comment: ${commentId} -->`);
  });
});
