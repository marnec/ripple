import { describe, expect, it } from "vitest";
import { internal } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";

/**
 * `checkAccessBatch` is what PartyKit's periodic re-validation runs — one
 * query per room per tick. It must answer for every user it was asked about
 * with the workspace rule (`hasResourceAccess`) applied per user, so an
 * outsider in a room cannot hide behind the members it is batched with.
 */
describe("collaboration.checkAccessBatch", () => {
  it("answers per user under the workspace rule for a document room", async () => {
    const t = createTestContext();
    const { userId: member, workspaceId } = await setupWorkspaceWithAdmin(t);
    const { userId: outsider } = await setupWorkspaceWithAdmin(
      t,
      "Other Workspace",
    );
    const documentId = await t.run((ctx) =>
      ctx.db.insert("documents", { workspaceId, name: "Doc" }),
    );

    const results = await t.query(internal.collaboration.checkAccessBatch, {
      userIds: [member, outsider],
      resourceType: "doc",
      resourceId: documentId,
    });

    expect(results).toEqual([
      { userId: member, hasAccess: true },
      { userId: outsider, hasAccess: false },
    ]);
  });

  it("answers presence rooms by workspace membership", async () => {
    const t = createTestContext();
    const { userId: member, workspaceId } = await setupWorkspaceWithAdmin(t);
    const { userId: stranger } = await setupAuthenticatedUser(t, {
      email: "stranger@example.com",
    });

    const results = await t.query(internal.collaboration.checkAccessBatch, {
      userIds: [stranger, member],
      resourceType: "presence",
      resourceId: workspaceId,
    });

    expect(results).toEqual([
      { userId: stranger, hasAccess: false },
      { userId: member, hasAccess: true },
    ]);
  });
});
