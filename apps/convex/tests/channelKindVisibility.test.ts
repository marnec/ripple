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
 * The pre-split-row tests lived here, and end with this change.
 *
 * They seeded a channel carrying only `type` and drove
 * `backfillChannelKindVisibility` and `stripChannelType` over it. Now that
 * `kind` and `visibility` are required, `convex-test` validates that fixture
 * against the live schema and refuses it — `as never` silences the compiler,
 * not the validator. The shape is no longer expressible, which is the whole
 * point of the schema being strict.
 *
 * They were retired once before, in ticket 10, and that was one step too early:
 * making the legacy shape unrepresentable is precisely what broke a production
 * deploy, because `convex deploy` pushes the schema before `runAll` can migrate
 * anything. This time the columns became required only *after* production was
 * verified to hold no such row. That verification, not a test, is what makes it
 * safe — and it has to be redone against any deployment that has not seen the
 * migration, including one restored from an old backup.
 *
 * Both migrations stay in `runAll` as the repair path for exactly that case.
 */
