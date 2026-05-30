import { describe, expect, it } from "vitest";
import {
  externalLoginToMember,
  externalUserIdToMember,
  memberToExternalLogin,
  memberToExternalUserId,
} from "../convex/integrations/core/identity";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";

/**
 * Direct tests for the provider-neutral identity matcher. The override layer
 * (`workspaceMemberExternalIdentity`) is provider-generic; the OAuth-captured
 * fallback (`users.githubLogin`) is GitHub-only and must be skipped for other
 * providers.
 */
describe("integrations/core/identity externalLoginToMember", () => {
  it("resolves a login via the per-workspace override (any provider)", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    await t.run((ctx) =>
      ctx.db.insert("workspaceMemberExternalIdentity", {
        workspaceId,
        userId,
        provider: "gitlab",
        externalLogin: "alice",
      }),
    );

    const resolved = await t.run((ctx) =>
      externalLoginToMember(ctx, workspaceId, "gitlab", "Alice"),
    );
    expect(resolved).toBe(userId);
  });

  it("falls back to the OAuth-captured login for github", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    await t.run((ctx) => ctx.db.patch(userId, { githubLogin: "octocat" }));

    const resolved = await t.run((ctx) =>
      externalLoginToMember(ctx, workspaceId, "github", "octocat"),
    );
    expect(resolved).toBe(userId);
  });

  it("does NOT use the github OAuth login for a non-github provider", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    await t.run((ctx) => ctx.db.patch(userId, { githubLogin: "octocat" }));

    const resolved = await t.run((ctx) =>
      externalLoginToMember(ctx, workspaceId, "gitlab", "octocat"),
    );
    expect(resolved ?? undefined).toBeUndefined();
  });

  it("returns undefined for an unknown login", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const resolved = await t.run((ctx) =>
      externalLoginToMember(ctx, workspaceId, "github", "nobody"),
    );
    expect(resolved ?? undefined).toBeUndefined();
  });
});

describe("integrations/core/identity externalUserIdToMember", () => {
  it("resolves a numeric provider user id via the override (any provider)", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    await t.run((ctx) =>
      ctx.db.insert("workspaceMemberExternalIdentity", {
        workspaceId,
        userId,
        provider: "gitlab",
        externalLogin: "alice",
        externalUserId: "12345",
      }),
    );

    const resolved = await t.run((ctx) =>
      externalUserIdToMember(ctx, workspaceId, "gitlab", "12345"),
    );
    expect(resolved).toBe(userId);
  });

  it("is provider-scoped: same id under a different provider does not match", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    await t.run((ctx) =>
      ctx.db.insert("workspaceMemberExternalIdentity", {
        workspaceId,
        userId,
        provider: "gitlab",
        externalLogin: "alice",
        externalUserId: "12345",
      }),
    );

    const resolved = await t.run((ctx) =>
      externalUserIdToMember(ctx, workspaceId, "github", "12345"),
    );
    expect(resolved ?? undefined).toBeUndefined();
  });

  it("returns undefined for an unknown id", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const resolved = await t.run((ctx) =>
      externalUserIdToMember(ctx, workspaceId, "gitlab", "99999"),
    );
    expect(resolved ?? undefined).toBeUndefined();
  });

  it("falls back to the OAuth-captured gitlab user id for gitlab", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    await t.run((ctx) => ctx.db.patch(userId, { gitlabUserId: "42" }));

    const resolved = await t.run((ctx) =>
      externalUserIdToMember(ctx, workspaceId, "gitlab", "42"),
    );
    expect(resolved).toBe(userId);
  });

  it("does NOT use the captured gitlab id for a non-gitlab provider", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    await t.run((ctx) => ctx.db.patch(userId, { gitlabUserId: "42" }));

    const resolved = await t.run((ctx) =>
      externalUserIdToMember(ctx, workspaceId, "github", "42"),
    );
    expect(resolved ?? undefined).toBeUndefined();
  });

  it("does NOT match a captured gitlab id for a non-member of the workspace", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    // A user who carries the gitlab id but is NOT a member of this workspace.
    await t.run((ctx) =>
      ctx.db.insert("users", { name: "outsider", gitlabUserId: "42" }),
    );

    const resolved = await t.run((ctx) =>
      externalUserIdToMember(ctx, workspaceId, "gitlab", "42"),
    );
    expect(resolved ?? undefined).toBeUndefined();
  });

  it("override wins over the OAuth-captured gitlab id", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const otherUserId = await t.run((ctx) =>
      ctx.db.insert("users", { name: "other" }),
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(userId, { gitlabUserId: "42" });
      await ctx.db.insert("workspaceMemberExternalIdentity", {
        workspaceId,
        userId: otherUserId,
        provider: "gitlab",
        externalLogin: "other",
        externalUserId: "42",
      });
    });

    const resolved = await t.run((ctx) =>
      externalUserIdToMember(ctx, workspaceId, "gitlab", "42"),
    );
    expect(resolved).toBe(otherUserId);
  });
});

describe("integrations/core/identity memberToExternalUserId", () => {
  it("returns the override user id for the given provider", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    await t.run((ctx) =>
      ctx.db.insert("workspaceMemberExternalIdentity", {
        workspaceId,
        userId,
        provider: "gitlab",
        externalLogin: "alice",
        externalUserId: "12345",
      }),
    );

    const id = await t.run((ctx) =>
      memberToExternalUserId(ctx, workspaceId, userId, "gitlab"),
    );
    expect(id).toBe("12345");
  });

  it("falls back to the OAuth-captured gitlab id only for gitlab", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    await t.run((ctx) => ctx.db.patch(userId, { gitlabUserId: "42" }));

    expect(
      await t.run((ctx) =>
        memberToExternalUserId(ctx, workspaceId, userId, "gitlab"),
      ),
    ).toBe("42");
    expect(
      (await t.run((ctx) =>
        memberToExternalUserId(ctx, workspaceId, userId, "github"),
      )) ?? undefined,
    ).toBeUndefined();
  });
});

describe("integrations/core/identity memberToExternalLogin", () => {
  it("returns the override login for the given provider", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    await t.run((ctx) =>
      ctx.db.insert("workspaceMemberExternalIdentity", {
        workspaceId,
        userId,
        provider: "gitlab",
        externalLogin: "alice",
      }),
    );

    const login = await t.run((ctx) =>
      memberToExternalLogin(ctx, workspaceId, userId, "gitlab"),
    );
    expect(login).toBe("alice");
  });

  it("falls back to the OAuth-captured github login only for github", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    await t.run((ctx) => ctx.db.patch(userId, { githubLogin: "octocat" }));

    expect(
      await t.run((ctx) =>
        memberToExternalLogin(ctx, workspaceId, userId, "github"),
      ),
    ).toBe("octocat");
    expect(
      (await t.run((ctx) =>
        memberToExternalLogin(ctx, workspaceId, userId, "gitlab"),
      )) ?? undefined,
    ).toBeUndefined();
  });
});
