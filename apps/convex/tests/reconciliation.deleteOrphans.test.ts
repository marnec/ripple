import { describe, expect, it } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { ChannelRole } from "@ripple/shared/enums/roles";
import { createTestContext, setupWorkspaceWithAdmin, channelFields } from "./helpers";

/**
 * `deleteOrphans` is the repair half of the cascade-failure runbook: the
 * operator sees a `severity: "error"` cascade audit entry, runs
 * `orphanReport`, then loops `deleteOrphans` "until `remaining` is false".
 *
 * The loop only terminates if the scan advances. Deletion alone can't advance
 * it — healthy rows are left in place by design, so an uncursored
 * `.take(cap)` re-reads the identical prefix forever and every orphan past
 * row `cap` is unreachable. These tests pin the cursor.
 */
async function seedChannelMembers(
  t: ReturnType<typeof createTestContext>,
  opts: {
    workspaceId: Id<"workspaces">;
    userId: Id<"users">;
    healthy: number;
    orphans: number;
  },
) {
  return await t.run(async (ctx) => {
    const liveChannelId = await ctx.db.insert("channels", {
      name: "general",
      workspaceId: opts.workspaceId,
      ...channelFields("open"),
    });
    // A channel we delete immediately — its members become the orphans.
    const deadChannelId = await ctx.db.insert("channels", {
      name: "gone",
      workspaceId: opts.workspaceId,
      ...channelFields("open"),
    });

    // Healthy rows FIRST so they occupy the head of the table: this is the
    // prefix an uncursored scan would re-read on every invocation.
    for (let i = 0; i < opts.healthy; i++) {
      await ctx.db.insert("channelMembers", {
        channelId: liveChannelId,
        workspaceId: opts.workspaceId,
        userId: opts.userId,
        role: ChannelRole.MEMBER,
      });
    }
    const orphanIds: Id<"channelMembers">[] = [];
    for (let i = 0; i < opts.orphans; i++) {
      orphanIds.push(
        await ctx.db.insert("channelMembers", {
          channelId: deadChannelId,
          workspaceId: opts.workspaceId,
          userId: opts.userId,
          role: ChannelRole.MEMBER,
        }),
      );
    }

    // Raw delete, no cascade — exactly the state a half-failed cascade leaves.
    await ctx.db.delete(deadChannelId);

    return { orphanIds };
  });
}

describe("reconciliation.deleteOrphans", () => {
  it("reaches orphans that sit past the first page when the cursor is threaded", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
    const { orphanIds } = await seedChannelMembers(t, {
      workspaceId,
      userId,
      healthy: 5,
      orphans: 3,
    });

    let after: number | undefined = undefined;
    let totalDeleted = 0;
    let passes = 0;
    for (;;) {
      const res: {
        deleted: number;
        scanned: number;
        remaining: boolean;
        cursor?: number;
      } = await t.mutation(internal.reconciliation.deleteOrphans, {
        childTable: "channelMembers",
        parentField: "channelId",
        batchSize: 2,
        after,
      });
      totalDeleted += res.deleted;
      after = res.cursor;
      passes++;
      expect(passes).toBeLessThan(20); // the loop must terminate
      if (!res.remaining) break;
    }

    expect(totalDeleted).toBe(3);

    const survivors = await t.run(async (ctx) =>
      Promise.all(orphanIds.map((id) => ctx.db.get(id))),
    );
    expect(survivors.every((row) => row === null)).toBe(true);

    // The healthy rows are untouched.
    const left = await t.run((ctx) => ctx.db.query("channelMembers").collect());
    expect(left).toHaveLength(5);
  });

  it("advances the cursor past a page that deleted nothing", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
    await seedChannelMembers(t, {
      workspaceId,
      userId,
      healthy: 4,
      orphans: 1,
    });

    // First page is all-healthy: zero deletes, but it must still hand back a
    // cursor and report more rows behind it. Without that the operator's loop
    // is infinite and the single orphan is unreachable.
    const first = await t.mutation(internal.reconciliation.deleteOrphans, {
      childTable: "channelMembers",
      parentField: "channelId",
      batchSize: 2,
    });
    expect(first.deleted).toBe(0);
    expect(first.remaining).toBe(true);
    expect(first.cursor).toBeTypeOf("number");

    const second = await t.mutation(internal.reconciliation.deleteOrphans, {
      childTable: "channelMembers",
      parentField: "channelId",
      batchSize: 2,
      after: first.cursor,
    });
    // Page 2 is rows 3-4 (still healthy) — different rows, so the scan moved.
    expect(second.cursor).toBeGreaterThan(first.cursor!);

    const third = await t.mutation(internal.reconciliation.deleteOrphans, {
      childTable: "channelMembers",
      parentField: "channelId",
      batchSize: 2,
      after: second.cursor,
    });
    expect(third.deleted).toBe(1);
    expect(third.remaining).toBe(false);
  });

  /**
   * A series owns rows in two tables that nothing else would reach if its
   * cascade died mid-batch — the roster, and the overrides standing in for its
   * edited occurrences. Both are the expensive kind of leftover: an override
   * is a `calendarEvents` row, so it keeps showing on the calendar as an event
   * belonging to a series that no longer exists.
   */
  it("repairs the rows a failed series cascade would leave behind", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);

    await t.run(async (ctx) => {
      const seriesId = await ctx.db.insert("eventSeries", {
        workspaceId,
        title: "Standup",
        anchorDate: "2026-09-01",
        anchorTime: "09:00",
        durationMs: 30 * 60 * 1000,
        timezone: "Europe/Rome",
        rule: { freq: "weekly", interval: 1, weekdays: ["tuesday"], end: { kind: "never" } },
        createdBy: userId,
        activeUntil: 8_640_000_000_000_000,
      });
      await ctx.db.insert("eventSeriesInvitees", {
        seriesId,
        workspaceId,
        userId,
        status: "pending",
      });
      const startsAt = Date.parse("2026-09-08T07:00:00.000Z");
      await ctx.db.insert("calendarEvents", {
        workspaceId,
        title: "Standup (moved)",
        startsAt,
        endsAt: startsAt + 30 * 60 * 1000,
        timezone: "Europe/Rome",
        createdBy: userId,
        seriesId,
        originalStartMs: startsAt,
      });
      // The cascade died here: the root went, its children did not.
      await ctx.db.delete(seriesId);
    });

    expect(
      await t.mutation(internal.reconciliation.deleteOrphans, {
        childTable: "eventSeriesInvitees",
        parentField: "seriesId",
      }),
    ).toMatchObject({ deleted: 1 });
    expect(
      await t.mutation(internal.reconciliation.deleteOrphans, {
        childTable: "calendarEvents",
        parentField: "seriesId",
      }),
    ).toMatchObject({ deleted: 1 });
  });

  it("rejects a relationship it doesn't know about", async () => {
    const t = createTestContext();
    await setupWorkspaceWithAdmin(t);

    await expect(
      t.mutation(internal.reconciliation.deleteOrphans, {
        childTable: "channelMembers",
        parentField: "notAField",
      }),
    ).rejects.toThrow(/Unknown relationship/);
  });
});
