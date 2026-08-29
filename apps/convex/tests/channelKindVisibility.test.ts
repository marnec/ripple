import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";

/**
 * The `type` → `kind` + `visibility` split (docs/adr/0001): that the writers
 * populate all three columns, and that the backfill maps the three old values
 * correctly for rows that predate them.
 */
describe("channels.create — populates kind and visibility", () => {
  it("writes a public channel", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const channelId = await asUser.mutation(api.channels.create, {
      name: "general",
      workspaceId,
      visibility: "public",
    });

    const channel = await t.run(async (ctx) => ctx.db.get(channelId));
    expect(channel?.kind).toBe("channel");
    expect(channel?.visibility).toBe("public");
  });

  it("writes a private channel", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const channelId = await asUser.mutation(api.channels.create, {
      name: "leadership",
      workspaceId,
      visibility: "private",
    });

    const channel = await t.run(async (ctx) => ctx.db.get(channelId));
    expect(channel?.kind).toBe("channel");
    expect(channel?.visibility).toBe("private");
  });
});

describe("channels.createDm — populates kind and visibility", () => {
  it("writes a direct message whose visibility is the derived constant", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);
    const { userId: memberId } = await setupAuthenticatedUser(t, {
      name: "Member",
      email: "member@test.com",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceMembers", {
        userId: memberId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    const channelId = await asAdmin.mutation(api.channels.createDm, {
      workspaceId,
      otherUserId: memberId,
    });

    const channel = await t.run(async (ctx) => ctx.db.get(channelId));
    expect(channel?.kind).toBe("dm");
    // Present so the column can be required at the contract step, not because
    // a conversation has a visibility to set. Nothing may read it as a setting.
    expect(channel?.visibility).toBe("private");
  });
});

/**
 * The backfill's own tests lived here, and cannot survive this step.
 *
 * They worked by seeding a row in the pre-split shape — `type` and nothing
 * else — and running the migration over it. `convex-test` validates inserts
 * against the live schema at runtime, so once `kind` and `visibility` became
 * required that fixture stopped being constructible; `as never` silences the
 * compiler but not the validator. The same is true of `stripChannelType`, whose
 * fixture needs a `type` the schema is about to stop declaring.
 *
 * This is the ordinary end state for a repair path: `migrateChannelIsPublicToType`
 * has never had tests either, for exactly this reason. Both migrations stay in
 * `runAll` because a restored backup can reintroduce the old shape.
 *
 * Worth recording what was lost: the mapping test caught a real defect during
 * ticket 07, when the backfill was deriving `kind` and `visibility` through the
 * predicates that had just started reading `kind` and `visibility`. It did its
 * job while the shape it asserted still existed.
 */

