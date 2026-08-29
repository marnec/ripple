import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { createTestContext, setupWorkspaceWithAdmin, channelFields } from "./helpers";
import { ChannelRole } from "@ripple/shared/enums/roles";
import type { Id } from "../convex/_generated/dataModel";

/**
 * The sidebar payload is "the channels I hold a membership row for" merged with
 * "every open channel". Those sets overlap: `channelMembers` rows on OPEN
 * channels are explicitly permitted (`channelMembers.add`) and
 * `approveJoinRequest` is a second path to one. Concatenating rendered such a
 * channel twice — duplicate React keys, and a doubled hidden count.
 *
 * The second site the audit named, `channels.listByUserMembership`, had the
 * same defect and zero callers; it was deleted rather than fixed.
 */

type TestContext = ReturnType<typeof createTestContext>;

async function openChannelWithMembership(
  t: TestContext,
  opts: { workspaceId: Id<"workspaces">; userId: Id<"users">; name?: string },
) {
  return await t.run(async (ctx) => {
    const channelId = await ctx.db.insert("channels", {
      name: opts.name ?? "announcements",
      workspaceId: opts.workspaceId,
      ...channelFields("open"),
    });
    await ctx.db.insert("channelMembers", {
      channelId,
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      role: ChannelRole.MEMBER,
    });
    return channelId;
  });
}

describe("open channel with an explicit membership row", () => {

  it("appears once in the sidebar payload", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await openChannelWithMembership(t, {
      workspaceId,
      userId,
    });

    const data = await asUser.query(api.workspaceSidebarData.get, {
      workspaceId,
    });

    expect(data.channels.filter((c) => c._id === channelId)).toHaveLength(1);
  });

  it("appears exactly once when dismissed, not twice", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await openChannelWithMembership(t, {
      workspaceId,
      userId,
    });
    await t.run((ctx) =>
      ctx.db.insert("userChannelState", {
        channelId,
        workspaceId,
        userId,
        hiddenAt: Date.now(),
      }),
    );

    const data = await asUser.query(api.workspaceSidebarData.get, {
      workspaceId,
    });

    // The dedup is the point: a public channel the viewer also has an explicit
    // membership row for arrives from both halves of the sidebar query, and
    // used to be returned — and counted — twice.
    const rows = data.channels.filter((c) => c._id === channelId);
    expect(rows).toHaveLength(1);
    expect(rows[0].isHidden).toBe(true);
  });

});
