import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";

beforeEach(() => {
  vi.useFakeTimers();
  process.env.GITHUB_APP_SLUG = "ripple-test-app";
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.GITHUB_APP_SLUG;
});

describe("integrations/core/installFlow.beginAppInstall", () => {
  it("returns an install URL that embeds the app slug and a state nonce", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const { url } = await asUser.mutation(
      api.integrations.core.installFlow.beginAppInstall,
      { workspaceId },
    );

    expect(url).toContain(
      "https://github.com/apps/ripple-test-app/installations/new",
    );
    const state = new URL(url).searchParams.get("state");
    expect(state).toBeTruthy();

    // A state row was persisted for that nonce.
    const row = await t.run((ctx) =>
      ctx.db
        .query("integrationInstallStates")
        .withIndex("by_nonce", (q) => q.eq("nonce", state!))
        .unique(),
    );
    expect(row?.workspaceId).toBe(workspaceId);
  });

  it("rejects non-admin members", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const { userId: memberId, asUser: asMember } = await setupAuthenticatedUser(
      t,
      { name: "Member", email: "if-member@test.com" },
    );
    await t.run((ctx) =>
      ctx.db.insert("workspaceMembers", {
        userId: memberId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      }),
    );

    await expect(
      asMember.mutation(api.integrations.core.installFlow.beginAppInstall, {
        workspaceId,
      }),
    ).rejects.toThrow();
  });
});

describe("integrations/core/installFlow.consumeInstallState", () => {
  it("returns the workspaceId + userId for a valid nonce and deletes the row", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const { url } = await asUser.mutation(
      api.integrations.core.installFlow.beginAppInstall,
      { workspaceId },
    );
    const nonce = new URL(url).searchParams.get("state")!;

    const result = await t.mutation(
      internal.integrations.core.installFlow.consumeInstallState,
      { nonce },
    );

    expect(result?.workspaceId).toBe(workspaceId);
    expect(result?.userId).toBe(userId);

    // One-time use: the row is gone.
    const row = await t.run((ctx) =>
      ctx.db
        .query("integrationInstallStates")
        .withIndex("by_nonce", (q) => q.eq("nonce", nonce))
        .unique(),
    );
    expect(row).toBeNull();
  });

  it("returns null for an unknown nonce", async () => {
    const t = createTestContext();
    const result = await t.mutation(
      internal.integrations.core.installFlow.consumeInstallState,
      { nonce: "does-not-exist" },
    );
    expect(result).toBeNull();
  });

  it("returns null for an expired nonce", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const { url } = await asUser.mutation(
      api.integrations.core.installFlow.beginAppInstall,
      { workspaceId },
    );
    const nonce = new URL(url).searchParams.get("state")!;

    // Jump past the state TTL (15 min).
    vi.advanceTimersByTime(16 * 60 * 1000);

    const result = await t.mutation(
      internal.integrations.core.installFlow.consumeInstallState,
      { nonce },
    );
    expect(result).toBeNull();
  });
});
