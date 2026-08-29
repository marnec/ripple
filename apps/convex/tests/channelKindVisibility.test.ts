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

describe("rows that predate the split", () => {
  /** A channel as it exists in a deployment that has never been migrated. */
  async function seedLegacy(
    t: ReturnType<typeof createTestContext>,
    opts: { workspaceId: Id<"workspaces">; name: string; type: "open" | "closed" | "dm" },
  ) {
    return t.run(async (ctx) =>
      ctx.db.insert("channels", {
        name: opts.name,
        workspaceId: opts.workspaceId,
        type: opts.type,
      }),
    );
  }

  const runMigration = (
    t: ReturnType<typeof createTestContext>,
    fn: typeof internal.migrations.backfillChannelKindVisibility,
  ) => t.mutation(fn, { cursor: null, batchSize: 100 });

  it("can exist at all — the schema has to accept them", async () => {
    // This is the shape that broke a production deploy. `convex deploy` pushes
    // the schema before `migrations:runAll` can run, and Convex validates every
    // existing document at push time — so a schema requiring `kind` cannot
    // reach a deployment whose rows lack it, because the migration that would
    // add it ships in the very same push. If this test stops passing, that
    // deploy is broken again.
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const id = await seedLegacy(t, { workspaceId, name: "italia 1", type: "open" });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.type).toBe("open");
    expect(row?.kind).toBeUndefined();
  });

  it("backfills into kind and visibility", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const openId = await seedLegacy(t, { workspaceId, name: "general", type: "open" });
    const closedId = await seedLegacy(t, { workspaceId, name: "leadership", type: "closed" });
    const dmId = await seedLegacy(t, { workspaceId, name: "", type: "dm" });

    await runMigration(t, internal.migrations.backfillChannelKindVisibility);

    const [open, closed, dm] = await t.run(async (ctx) => [
      await ctx.db.get(openId),
      await ctx.db.get(closedId),
      await ctx.db.get(dmId),
    ]);
    expect(open).toMatchObject({ kind: "channel", visibility: "public" });
    expect(closed).toMatchObject({ kind: "channel", visibility: "private" });
    // Inert, not a setting: a direct message has no visibility.
    expect(dm).toMatchObject({ kind: "dm", visibility: "private" });
  });

  it("then strips the retired column, and both migrations are idempotent", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const id = await seedLegacy(t, { workspaceId, name: "general", type: "open" });

    await runMigration(t, internal.migrations.backfillChannelKindVisibility);
    await runMigration(t, internal.migrations.stripChannelType);
    const once = await t.run(async (ctx) => ctx.db.get(id));
    expect(once?.type).toBeUndefined();
    expect(once).toMatchObject({ kind: "channel", visibility: "public" });

    // `runAll` executes on every deploy, so a second pass must change nothing.
    await runMigration(t, internal.migrations.backfillChannelKindVisibility);
    await runMigration(t, internal.migrations.stripChannelType);
    expect(await t.run(async (ctx) => ctx.db.get(id))).toEqual(once);
  });
});


