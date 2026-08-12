import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { createTestContext, setupAuthenticatedUser } from "./helpers";

type T = ReturnType<typeof createTestContext>;

async function makePlatformAdmin(t: T, email = "ops@example.com") {
  const { userId, asUser } = await setupAuthenticatedUser(t, {
    name: "Platform Admin",
    email,
  });
  await t.run((ctx) => ctx.db.patch(userId, { isPlatformAdmin: true }));
  return { adminId: userId, asAdmin: asUser };
}

async function insertFailure(
  t: T,
  args: { kind: string; key: string; error?: string; failedAt?: number },
) {
  return t.run((ctx) =>
    ctx.db.insert("backgroundJobFailures", {
      kind: args.kind,
      key: args.key,
      error: args.error ?? "boom",
      failedAt: args.failedAt ?? Date.now(),
    }),
  );
}

/**
 * The read side of the surface T6 built. `backgroundJobFailures` is the one
 * table in the app that means "Ripple promised to finish this and didn't" —
 * a drain that exhausted its retries, or an outbound mirror abandoned after
 * the provider write already committed. It is platform-global by design (no
 * `workspaceId`), which is exactly why it belongs to the operator console and
 * not to a workspace screen.
 */
describe("admin.jobs.list", () => {
  it("refuses a signed-in user who is not a platform admin", async () => {
    const t = createTestContext();
    const { asUser } = await setupAuthenticatedUser(t, {
      name: "Regular",
      email: "regular@example.com",
    });
    await insertFailure(t, { kind: "tagSync:stripTagEverywhere", key: "tag1" });

    await expect(asUser.query(api.admin.jobs.list, {})).rejects.toThrow();
  });

  it("refuses an anonymous caller", async () => {
    const t = createTestContext();
    await expect(t.query(api.admin.jobs.list, {})).rejects.toThrow();
  });

  it("returns the newest failures first, whole", async () => {
    const t = createTestContext();
    const { asAdmin } = await makePlatformAdmin(t);

    await insertFailure(t, {
      kind: "tagSync:stripTagEverywhere",
      key: "tag1",
      error: "first",
      failedAt: 1_000,
    });
    await insertFailure(t, {
      kind: "integrations.outbound:createIssue",
      key: "task9",
      error: "recorder unreachable",
      failedAt: 2_000,
    });

    const { failures, truncated } = await asAdmin.query(api.admin.jobs.list, {});

    expect(truncated).toBe(false);
    expect(failures.map((f) => f.key)).toEqual(["task9", "tag1"]);
    expect(failures[0]).toMatchObject({
      kind: "integrations.outbound:createIssue",
      key: "task9",
      error: "recorder unreachable",
      failedAt: 2_000,
    });
  });

  /**
   * A worklist that silently drops rows reads as "that's all of them", which
   * is the opposite of what this table is for. The cap is real (a drain
   * failing on a schedule can produce rows indefinitely), so the page has to
   * be told when it is looking at a window rather than the whole set.
   */
  it("caps the page and says so rather than implying it showed everything", async () => {
    const t = createTestContext();
    const { asAdmin } = await makePlatformAdmin(t);

    for (let i = 0; i < 205; i += 1) {
      await insertFailure(t, {
        kind: "notificationSubscriptionJobs:publicChannelCreated",
        key: `channel${i}`,
      });
    }

    const { failures, truncated } = await asAdmin.query(api.admin.jobs.list, {});

    expect(failures).toHaveLength(200);
    expect(truncated).toBe(true);
  });

  it("healthy deployment: an empty list, not an error", async () => {
    const t = createTestContext();
    const { asAdmin } = await makePlatformAdmin(t);

    await expect(asAdmin.query(api.admin.jobs.list, {})).resolves.toEqual({
      failures: [],
      truncated: false,
    });
  });
});

describe("admin.jobs.dismiss", () => {
  it("removes the row an operator has dealt with", async () => {
    const t = createTestContext();
    const { asAdmin } = await makePlatformAdmin(t);
    const id = await insertFailure(t, {
      kind: "integrations.outbound:createIssue",
      key: "task9",
    });
    await insertFailure(t, { kind: "tagSync:stripTagEverywhere", key: "tag1" });

    await asAdmin.mutation(api.admin.jobs.dismiss, { failureId: id });

    const left = await t.run((ctx) =>
      ctx.db.query("backgroundJobFailures").collect(),
    );
    expect(left.map((f) => f.key)).toEqual(["tag1"]);
  });

  it("is not a way for a non-admin to erase the evidence", async () => {
    const t = createTestContext();
    const { asUser } = await setupAuthenticatedUser(t, {
      name: "Regular",
      email: "regular@example.com",
    });
    const id = await insertFailure(t, {
      kind: "tagSync:stripTagEverywhere",
      key: "tag1",
    });

    await expect(
      asUser.mutation(api.admin.jobs.dismiss, { failureId: id }),
    ).rejects.toThrow();
    const left = await t.run((ctx) =>
      ctx.db.query("backgroundJobFailures").collect(),
    );
    expect(left).toHaveLength(1);
  });

  it("a row already dismissed elsewhere is a no-op, not a crash", async () => {
    const t = createTestContext();
    const { asAdmin } = await makePlatformAdmin(t);
    const id = await insertFailure(t, {
      kind: "tagSync:stripTagEverywhere",
      key: "tag1",
    });
    await t.run((ctx) => ctx.db.delete(id));

    await expect(
      asAdmin.mutation(api.admin.jobs.dismiss, { failureId: id }),
    ).resolves.toBeNull();
  });
});

describe("admin.stats.overview", () => {
  /**
   * The console's landing page is where an operator finds out something is
   * wrong without going looking for it — a jobs page nobody opens is the same
   * 7-day log this theme replaced.
   */
  it("counts failed background jobs so the Overview can raise them", async () => {
    const t = createTestContext();
    const { asAdmin } = await makePlatformAdmin(t);
    await insertFailure(t, { kind: "tagSync:stripTagEverywhere", key: "tag1" });
    await insertFailure(t, {
      kind: "integrations.outbound:createIssue",
      key: "task9",
    });

    const stats = await asAdmin.query(api.admin.stats.overview, {});
    expect(stats.failedJobs).toBe(2);
  });
});

/** Type-level guard: the page keys rows by id, so the id must be returned. */
export type _JobRowId = Id<"backgroundJobFailures">;
