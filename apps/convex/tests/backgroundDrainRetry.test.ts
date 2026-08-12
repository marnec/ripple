/**
 * T6 phase 3 — the drains.
 *
 * A scheduled *action* is at-most-once: Convex does not retry it, and its
 * failure is invisible outside `_scheduled_functions`. Every paged drain in
 * this codebase is a scheduled action, so a single thrown page used to abandon
 * the whole convergence silently. These tests pin the two properties that
 * replace that: the pool retries the drain, and a drain that gives up leaves a
 * row somebody can read.
 *
 * Failures are injected by wrapping the *page* function each drain calls —
 * the same seam production fails at (a transaction cap, an OCC conflict, a
 * transient read failure), one level below the entry point under test.
 */

import { expect, describe, it, vi, beforeEach, afterEach } from "vitest";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { triggers } from "../convex/dbTriggers";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";
import { api } from "../convex/_generated/api";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import type { Id } from "../convex/_generated/dataModel";

/**
 * Page control for the open-channel fanout.
 *
 * `pagesPerAttempt` holds `isDone` false so a three-member workspace drains in
 * as many pages as a three-thousand-member one — the real page size is 200, and
 * seeding 400 members to observe a mid-drain failure would buy nothing the
 * forced boundary does not. `failOnPage` then throws at a page boundary the way
 * a transaction cap or an OCC conflict does, after earlier pages have
 * committed. A restart is recognised by `cursor === null`, which is exactly how
 * the drain begins an attempt.
 */
const injected = vi.hoisted(() => ({
  pagesPerAttempt: 1,
  /** 1-based page that throws, once. Cleared as it fires, so the retry runs. */
  failOnPage: null as number | null,
  /** Every page throws, on every attempt — the retries-exhausted case. */
  failEveryPage: false,
  pageIndex: 0,
  /** Push delivery: make it throw, and count how often it was attempted. */
  pushThrows: false,
  pushFailures: 0,
}));

vi.mock("../convex/utils/sendPushToUsers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../convex/utils/sendPushToUsers")>();
  const fail = () => {
    injected.pushFailures += 1;
    throw new Error("injected push failure");
  };
  return {
    ...actual,
    sendPushToUsers: async (
      ...args: Parameters<typeof actual.sendPushToUsers>
    ) => (injected.pushThrows ? fail() : actual.sendPushToUsers(...args)),
    sendPushToFilteredUsers: async (
      ...args: Parameters<typeof actual.sendPushToFilteredUsers>
    ) => (injected.pushThrows ? fail() : actual.sendPushToFilteredUsers(...args)),
  };
});

vi.mock("../convex/notificationSubscriptionSync", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../convex/notificationSubscriptionSync")>();
  return {
    ...actual,
    subscribeChannelMembersPage: async (
      ...args: Parameters<typeof actual.subscribeChannelMembersPage>
    ) => {
      const cursor = args[3];
      if (cursor === null) injected.pageIndex = 0;
      injected.pageIndex += 1;
      const page = injected.pageIndex;

      if (injected.failEveryPage) throw new Error("injected page failure");
      if (injected.failOnPage === page) {
        injected.failOnPage = null;
        throw new Error("injected page failure");
      }

      const result = await actual.subscribeChannelMembersPage(...args);
      return page < injected.pagesPerAttempt
        ? { cursor: result.cursor, isDone: false }
        : result;
    },
  };
});

beforeEach(() => {
  injected.pagesPerAttempt = 1;
  injected.failOnPage = null;
  injected.failEveryPage = false;
  injected.pageIndex = 0;
  injected.pushThrows = false;
  injected.pushFailures = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

async function drain(t: ReturnType<typeof createTestContext>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

/** Extra workspace members, inserted raw so only the channel trigger fans out. */
async function seedMembers(
  t: ReturnType<typeof createTestContext>,
  workspaceId: Id<"workspaces">,
  count: number,
) {
  return await t.run(async (ctx) => {
    const ids: Id<"users">[] = [];
    for (let i = 0; i < count; i++) {
      const userId = await ctx.db.insert("users", {
        name: `Member ${i}`,
        email: `member${i}@example.com`,
      });
      await ctx.db.insert("workspaceMembers", {
        userId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
      ids.push(userId);
    }
    return ids;
  });
}

async function createOpenChannel(
  t: ReturnType<typeof createTestContext>,
  workspaceId: Id<"workspaces">,
) {
  return await t.run(async (ctx) => {
    const db = writerWithTriggers(ctx, ctx.db, triggers);
    return await db.insert("channels", {
      name: "general",
      workspaceId,
      type: "open" as const,
    });
  });
}

/**
 * The subscriptions the fanout produced, as id-free `member:category` keys so
 * two separate runs can be compared row for row. Duplicates survive the mapping
 * — that is the point: a replayed page that double-subscribed someone shows up
 * here as a repeated key, not as a silently-deduplicated set.
 */
async function fanoutKeys(
  t: ReturnType<typeof createTestContext>,
  channelId: Id<"channels">,
) {
  return await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("notificationSubscriptions")
      .withIndex("by_scope_category", (q) => q.eq("scope", channelId))
      .collect();
    const keys = await Promise.all(
      rows.map(async (row) => {
        const user = await ctx.db.get(row.userId);
        return `${user?.name ?? "?"}:${row.category}`;
      }),
    );
    return keys.sort();
  });
}

/** One full three-page fanout, optionally failing at the given page. */
async function runFanout(opts: { failOnPage?: number } = {}) {
  const t = createTestContext();
  const { workspaceId } = await setupWorkspaceWithAdmin(t);
  await seedMembers(t, workspaceId, 2);

  injected.pagesPerAttempt = 3;
  injected.failOnPage = opts.failOnPage ?? null;
  const channelId = await createOpenChannel(t, workspaceId);
  await drain(t);

  return await fanoutKeys(t, channelId);
}

describe("open-channel subscription fanout", () => {
  /**
   * That the drain is retried at all. The failure lands on the first page, so
   * nothing has committed when it throws: an at-most-once scheduled action
   * leaves the channel with zero subscriptions, which is what this drain did
   * before it went through a pool. The uninterrupted run is the source of
   * truth, so the assertion cannot drift as the category list changes.
   */
  it("still subscribes everyone when the first page throws", async () => {
    const uninterrupted = await runFanout();
    const interrupted = await runFanout({ failOnPage: 1 });

    expect(uninterrupted.length).toBeGreaterThan(0);
    expect(interrupted).toEqual(uninterrupted);
  });

  /**
   * The restart-safety claim, and the reason plain retry is enough here instead
   * of a persisted cursor: a retry resumes from `cursor: null`, so every page
   * that already committed runs a second time. Failing page 2 of 3 puts a
   * committed page 1 behind the failure and then replays it. Nobody ends up
   * subscribed twice because `insertSubscription` reads before it writes — were
   * that to change, this test fails with doubled keys, which is precisely the
   * regression the comment on `scheduleSubscriptionDrain` warns about.
   */
  it("does not double-subscribe when a replayed page runs again", async () => {
    const uninterrupted = await runFanout();
    const interrupted = await runFanout({ failOnPage: 2 });

    expect(uninterrupted.length).toBeGreaterThan(0);
    expect(interrupted).toEqual(uninterrupted);
  });

  /**
   * Retry is only half the answer: a drain that fails every attempt has still
   * given up, and the whole point of this theme is that giving up leaves a
   * trace on a row rather than a line in a 7-day log. The row has to name both
   * the drain and the thing it was draining, or "work that gave up" is not
   * actionable.
   */
  it("records a background job failure once retries are exhausted", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);

    injected.failEveryPage = true;
    const channelId = await createOpenChannel(t, workspaceId);
    await drain(t);

    const failures = await t.run(async (ctx) =>
      ctx.db.query("backgroundJobFailures").collect(),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].kind).toBe(
      "notificationSubscriptionJobs:publicChannelCreated",
    );
    expect(failures[0].key).toBe(channelId);
    expect(failures[0].error).toContain("injected page failure");
    expect(failures[0].failedAt).toEqual(expect.any(Number));
  });
});

describe("push delivery", () => {
  /**
   * The boundary of this theme, pinned so it is not "fixed" later. Everything
   * else here gained retry; `deliverPush` deliberately did not. A push has no
   * dedupe key on the delivery side, so a retried fan-out re-notifies everyone
   * the failed attempt already reached — and a duplicate buzz is worse for the
   * recipient than a notification they never knew was missing.
   *
   * A failure here is also not a `backgroundJobFailures` row: nothing gave up
   * on work it promised to finish, because at-most-once never promised it.
   */
  it("is attempted once and not retried when delivery throws", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await seedMembers(t, workspaceId, 1);

    const channelId = await createOpenChannel(t, workspaceId);
    await drain(t);

    injected.pushFailures = 0;
    injected.pushThrows = true;
    await asUser.mutation(api.messages.send, {
      isomorphicId: "push-retry-probe",
      body: JSON.stringify([
        { type: "paragraph", content: [{ type: "text", text: "hello" }] },
      ]),
      plainText: "hello",
      channelId,
    });
    await drain(t);

    expect(injected.pushFailures).toBe(1);
    const failures = await t.run(async (ctx) =>
      ctx.db.query("backgroundJobFailures").collect(),
    );
    expect(failures).toHaveLength(0);
  });
});

describe("tag-delete drain", () => {
  /**
   * The second family of drains — the ones already on `taskReassignPool`,
   * which until now had the pool but not the retry. `deleteTag` retires the
   * dictionary row immediately and leaves the strip to the drain, so a drain
   * that dies takes the tag off every picker while leaving it on every
   * resource: the worst of both states, and previously invisible.
   *
   * The failure is driven by data rather than a mock, because that is what the
   * batch can actually hit: a join row pointing at a row of another table makes
   * the strip's patch fail schema validation, on every attempt, exactly as a
   * genuinely undrainable batch would.
   */
  it("records a background job failure when a batch keeps throwing", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const documentId = await asUser.mutation(api.documents.create, { workspaceId });
    await asUser.mutation(api.documents.updateTags, {
      id: documentId,
      tags: ["ops"],
    });
    const tagId = await t.run(async (ctx) => {
      const tag = await ctx.db
        .query("tags")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .unique();
      // A join whose resourceId is the workspace itself: the strip patches
      // `tags` onto a row whose schema has no such field.
      await ctx.db.insert("entityTags", {
        workspaceId,
        tagId: tag!._id,
        tagName: tag!.name,
        resourceType: "document",
        resourceId: workspaceId,
      });
      return tag!._id;
    });

    await asUser.mutation(api.tagSync.deleteTag, { tagId });
    await drain(t);

    const failures = await t.run(async (ctx) =>
      ctx.db.query("backgroundJobFailures").collect(),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].kind).toBe("tagSync:stripTagEverywhere");
    expect(failures[0].key).toBe(tagId);
  });
});
