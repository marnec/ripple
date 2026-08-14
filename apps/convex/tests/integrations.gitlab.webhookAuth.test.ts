/**
 * Sweep #15 — the GitLab webhook route authenticates before it stores.
 *
 * The route used to read the body and hand it straight to the receiver
 * component, which durably inserts a `webhookEvents` row holding the full raw
 * body and every header, plus a `webhookDedup` row. Verification happened much
 * later, inside `handleGitlabWebhook` → `resolveGitlabInboundLink` — i.e. after
 * the write. Any unauthenticated caller could therefore POST arbitrary bytes
 * with a fresh `X-Gitlab-Event-UUID` per request and write attacker-chosen
 * content into the deployment at line rate, with no GitLab link needing to
 * exist at all.
 *
 * GitLab's secret is per-link rather than App-wide, so the route cannot verify
 * before resolving the way GitHub's does — it has to resolve the link from the
 * body first. That resolution is now a read-only query, and nothing durable
 * happens until it has authorized the delivery.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestContext, setupWorkspaceWithAdmin, setupProject } from "./helpers";
import { components } from "../convex/_generated/api";

const SECRET = "per-hook-secret-value";
const REPO_ID = "42";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A live GitLab project link — the only row the route's auth check reads. */
async function setupLink(
  t: ReturnType<typeof createTestContext>,
  opts: { status?: "active" | "disconnected"; secret?: string } = {},
) {
  const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });
  await t.run(async (ctx) => {
    await ctx.db.insert("projectIntegrationLinks", {
      workspaceId,
      projectId,
      status: opts.status ?? "active",
      pausedByBilling: false,
      externalRepoFullName: "acme/web",
      externalRepoId: REPO_ID,
      webhookSecret: opts.secret ?? SECRET,
    });
  });
  return { workspaceId, projectId };
}

function body(projectId: string | number = REPO_ID) {
  return JSON.stringify({
    object_kind: "issue",
    project: { id: projectId, path_with_namespace: "acme/web" },
    object_attributes: { id: 1, iid: 1, action: "open" },
  });
}

async function post(
  t: ReturnType<typeof createTestContext>,
  opts: {
    token?: string | null;
    event?: string | null;
    uuid?: string;
    rawBody?: string;
  } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-gitlab-event-uuid": opts.uuid ?? "delivery-1",
  };
  if (opts.event !== null) headers["x-gitlab-event"] = opts.event ?? "Issue Hook";
  if (opts.token !== null) headers["x-gitlab-token"] = opts.token ?? SECRET;

  const res = await t.fetch("/integrations/gitlab/webhook", {
    method: "POST",
    headers,
    body: opts.rawBody ?? body(),
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return res;
}

/** Everything the receiver component durably kept for this deployment. */
async function storedDeliveries(t: ReturnType<typeof createTestContext>) {
  return await t.run((ctx) =>
    ctx.runQuery(components.webhookReceiver.event.queries.listEvents, {}),
  );
}

describe("GitLab webhook route — authentication before storage", () => {
  /**
   * The attack the finding describes, in one test: no credential at all, and
   * the deployment must be left with nothing to show for the request. The
   * status assertion alone would not catch it — the old route stored the body
   * and *then* returned 200, so the row is the thing under test.
   */
  it("refuses an unauthenticated delivery and stores nothing", async () => {
    const t = createTestContext();
    await setupLink(t);

    const res = await post(t, { token: null });

    expect(res.status).toBe(401);
    expect(await storedDeliveries(t)).toHaveLength(0);
  });

  /** A wrong secret is the same case with a plausible-looking credential. */
  it("refuses a delivery whose token does not match the link's secret", async () => {
    const t = createTestContext();
    await setupLink(t);

    const res = await post(t, { token: "not-the-secret" });

    expect(res.status).toBe(401);
    expect(await storedDeliveries(t)).toHaveLength(0);
  });

  /**
   * No link at all is the cheapest version of the attack — the attacker picks
   * any project id — and the one the old route was most exposed to, since
   * nothing needed to exist in the workspace for the write to land.
   */
  it("refuses a delivery for a repo this deployment has no link for", async () => {
    const t = createTestContext();
    await setupLink(t);

    const res = await post(t, { rawBody: body("999") });

    expect(res.status).toBe(401);
    expect(await storedDeliveries(t)).toHaveLength(0);
  });

  /**
   * A disconnected link keeps its row (unlink retains it), and its stale secret
   * must not keep authenticating deliveries for a repo that is no longer wired
   * up — otherwise unlinking would not actually close the door.
   */
  it("refuses a delivery authenticated against a disconnected link", async () => {
    const t = createTestContext();
    await setupLink(t, { status: "disconnected" });

    const res = await post(t);

    expect(res.status).toBe(401);
    expect(await storedDeliveries(t)).toHaveLength(0);
  });

  /**
   * The bound on all of the above: a genuine delivery still goes through
   * untouched, body and all. Without this the route could pass every test here
   * by rejecting everything.
   */
  it("accepts and stores a delivery carrying the link's secret", async () => {
    const t = createTestContext();
    await setupLink(t);

    const res = await post(t);

    expect(res.status).toBe(200);
    const stored = await storedDeliveries(t);
    expect(stored).toHaveLength(1);
    expect(stored[0].provider).toBe("gitlab");
  });

  /**
   * Header hygiene, cheap and ahead of the body parse: a delivery with no
   * `x-gitlab-event` is not a GitLab hook, and the handler behind the receiver
   * drops it anyway — so storing it is pure cost.
   */
  it("refuses a delivery with no GitLab event header", async () => {
    const t = createTestContext();
    await setupLink(t);

    const res = await post(t, { event: null });

    expect(res.status).toBe(401);
    expect(await storedDeliveries(t)).toHaveLength(0);
  });

  /**
   * The size cap, set at the storage ceiling rather than an arbitrary number:
   * a `webhookEvents` row over Convex's 1 MiB document limit cannot be stored
   * at all, so accepting the request only trades a fast rejection for a failed
   * insert somewhere less visible.
   */
  it("refuses a body too large to store", async () => {
    const t = createTestContext();
    await setupLink(t);

    const filler = "x".repeat(1024 * 1024);
    const res = await post(t, {
      rawBody: JSON.stringify({
        object_kind: "issue",
        project: { id: REPO_ID },
        filler,
      }),
    });

    expect(res.status).toBe(413);
    expect(await storedDeliveries(t)).toHaveLength(0);
  });
});
