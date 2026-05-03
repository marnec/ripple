import { describe, it, expect, beforeEach } from "vitest";
import { api } from "../convex/_generated/api";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";

type TestContext = ReturnType<typeof createTestContext>;

async function createDocument(
  t: TestContext,
  workspaceId: string,
  name = "Doc",
) {
  return t.run(async (ctx) => {
    return ctx.db.insert("documents", {
      workspaceId: workspaceId as any,
      name,
    });
  });
}

async function addWorkspaceMember(
  t: TestContext,
  workspaceId: string,
  userId: string,
  role: "admin" | "member",
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("workspaceMembers", {
      workspaceId: workspaceId as any,
      userId: userId as any,
      role,
    });
  });
}

describe("shares", () => {
  let t: TestContext;
  beforeEach(() => {
    t = createTestContext();
  });

  describe("createShare", () => {
    it("workspace admin can create a share link for a document", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const documentId = await createDocument(t, workspaceId);

      const { shareId } = await asUser.mutation(api.shares.createShare, {
        resourceType: "document",
        resourceId: documentId,
        accessLevel: "view",
      });

      expect(shareId).toMatch(/^[A-Za-z0-9_-]{20,24}$/);
    });

    it("non-admin workspace member is rejected", async () => {
      const { workspaceId } = await setupWorkspaceWithAdmin(t);
      const documentId = await createDocument(t, workspaceId);
      const { userId: memberId, asUser: asMember } =
        await setupAuthenticatedUser(t, { email: "member@test.com" });
      await addWorkspaceMember(
        t,
        workspaceId,
        memberId,
        WorkspaceRole.MEMBER,
      );

      await expect(
        asMember.mutation(api.shares.createShare, {
          resourceType: "document",
          resourceId: documentId,
          accessLevel: "view",
        }),
      ).rejects.toThrow(/permission/i);
    });

    it("rejects view/edit access for channel resources", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await t.run(async (ctx) => {
        return ctx.db.insert("channels", {
          workspaceId: workspaceId as any,
          name: "general",
          type: "open",
        });
      });

      await expect(
        asUser.mutation(api.shares.createShare, {
          resourceType: "channel",
          resourceId: channelId,
          accessLevel: "view",
        }),
      ).rejects.toThrow(/not valid/i);
    });

    it("rejects an expiry in the past", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const documentId = await createDocument(t, workspaceId);

      await expect(
        asUser.mutation(api.shares.createShare, {
          resourceType: "document",
          resourceId: documentId,
          accessLevel: "view",
          expiresAt: Date.now() - 1,
        }),
      ).rejects.toThrow(/future/i);
    });
  });

  describe("getShareInfo (public)", () => {
    it("returns not_found for unknown shareId", async () => {
      const info = await t.query(api.shares.getShareInfo, {
        shareId: "bogus",
      });
      expect(info.status).toBe("not_found");
    });

    it("returns active info without requiring auth", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const documentId = await createDocument(t, workspaceId, "Hello");
      const { shareId } = await asUser.mutation(api.shares.createShare, {
        resourceType: "document",
        resourceId: documentId,
        accessLevel: "edit",
      });

      // No auth on this call — simulating a logged-out guest.
      const info = await t.query(api.shares.getShareInfo, { shareId });
      expect(info.status).toBe("active");
      expect(info.resourceName).toBe("Hello");
      expect(info.accessLevel).toBe("edit");
    });

    it("returns revoked after revokeShare", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const documentId = await createDocument(t, workspaceId);
      const { shareId } = await asUser.mutation(api.shares.createShare, {
        resourceType: "document",
        resourceId: documentId,
        accessLevel: "view",
      });
      await asUser.mutation(api.shares.revokeShare, { shareId });

      const info = await t.query(api.shares.getShareInfo, { shareId });
      expect(info.status).toBe("revoked");
    });

    it("returns expired when expiresAt has passed", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const documentId = await createDocument(t, workspaceId);
      const { shareId } = await asUser.mutation(api.shares.createShare, {
        resourceType: "document",
        resourceId: documentId,
        accessLevel: "view",
        expiresAt: Date.now() + 50, // will expire quickly
      });

      await new Promise((resolve) => setTimeout(resolve, 80));
      const info = await t.query(api.shares.getShareInfo, { shareId });
      expect(info.status).toBe("expired");
    });
  });

  describe("revokeShare", () => {
    it("only admin can revoke", async () => {
      const { workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);
      const documentId = await createDocument(t, workspaceId);
      const { shareId } = await asAdmin.mutation(api.shares.createShare, {
        resourceType: "document",
        resourceId: documentId,
        accessLevel: "view",
      });

      const { userId: memberId, asUser: asMember } =
        await setupAuthenticatedUser(t, { email: "m@test.com" });
      await addWorkspaceMember(
        t,
        workspaceId,
        memberId,
        WorkspaceRole.MEMBER,
      );

      await expect(
        asMember.mutation(api.shares.revokeShare, { shareId }),
      ).rejects.toThrow(/permission/i);
    });
  });
});
