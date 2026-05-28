import { describe, expect, it } from "vitest";
import {
  externalLoginToMember,
  externalUserIdToMember,
  memberToExternalLogin,
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
