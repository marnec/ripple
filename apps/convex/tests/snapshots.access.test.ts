import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";

/**
 * `getSnapshotUrl` hands out a signed storage URL for a resource's cold-start
 * snapshot — the full Yjs state. Reading it must require the same workspace
 * membership the collaboration-token path requires (`hasResourceAccess`), or a
 * signed-in user in any *other* workspace can read a workspace's documents by
 * id alone.
 */

async function storeBlob(
  t: ReturnType<typeof createTestContext>,
): Promise<Id<"_storage">> {
  return t.run((ctx) =>
    ctx.storage.store(
      new Blob([new Uint8Array([1, 2, 3])], {
        type: "application/octet-stream",
      }),
    ),
  );
}

/** A document in `workspaceId` that already has a snapshot blob attached. */
async function setupDocumentWithSnapshot(
  t: ReturnType<typeof createTestContext>,
  workspaceId: Id<"workspaces">,
): Promise<Id<"documents">> {
  const storageId = await storeBlob(t);
  return t.run((ctx) =>
    ctx.db.insert("documents", {
      workspaceId,
      name: "Confidential",
      yjsSnapshotId: storageId,
    }),
  );
}

describe("snapshots.getSnapshotUrl access", () => {
  it("denies the snapshot URL to a member of a different workspace", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t, "Owning Workspace");
    const documentId = await setupDocumentWithSnapshot(t, workspaceId);

    // A fully signed-in user — but a member of an unrelated workspace only.
    const { asUser: asOutsider } = await setupWorkspaceWithAdmin(t, "Other Workspace");

    const url = await asOutsider.query(api.snapshots.getSnapshotUrl, {
      resourceType: "doc",
      resourceId: documentId,
    });

    expect(url).toBeNull();
  });

  it("still returns the snapshot URL to a member of the owning workspace", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const documentId = await setupDocumentWithSnapshot(t, workspaceId);

    const url = await asUser.query(api.snapshots.getSnapshotUrl, {
      resourceType: "doc",
      resourceId: documentId,
    });

    expect(url).toEqual(expect.stringContaining("/api/storage/"));
  });

  it("denies access when the claimed resourceType does not match the id's table", async () => {
    // Convex ids carry their own table, so a mismatched `resourceType` still
    // resolves to the real row — and the membership check must run against
    // that row, not against the table the caller claimed.
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t, "Owning Workspace");
    const documentId = await setupDocumentWithSnapshot(t, workspaceId);

    const { asUser: asOutsider } = await setupWorkspaceWithAdmin(t, "Other Workspace");

    const url = await asOutsider.query(api.snapshots.getSnapshotUrl, {
      resourceType: "task",
      resourceId: documentId,
    });

    expect(url).toBeNull();
  });

  it("denies a diagram snapshot to a member of a different workspace", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t, "Owning Workspace");
    const storageId = await storeBlob(t);
    const diagramId = await t.run((ctx) =>
      ctx.db.insert("diagrams", {
        workspaceId,
        name: "Confidential",
        yjsSnapshotId: storageId,
      }),
    );

    const { asUser: asOutsider } = await setupWorkspaceWithAdmin(t, "Other Workspace");

    const url = await asOutsider.query(api.snapshots.getSnapshotUrl, {
      resourceType: "diagram",
      resourceId: diagramId,
    });

    expect(url).toBeNull();
  });
});

/**
 * `getStoredState` answers the same question, but separates "there is nothing
 * stored" from "you may not ask" — a distinction the client acts on, because
 * the first means the resource is genuinely empty and may be worked on offline.
 * Collapsing the two would let someone who has lost access author into a
 * document they can never sync, and merge a competing root into it later.
 */
describe("snapshots.getStoredState", () => {
  it("reports a stored snapshot to a member of the owning workspace", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const documentId = await setupDocumentWithSnapshot(t, workspaceId);

    const stored = await asUser.query(api.snapshots.getStoredState, {
      resourceType: "doc",
      resourceId: documentId,
    });

    expect(stored.status).toBe("stored");
    expect(stored).toHaveProperty("url", expect.stringContaining("/api/storage/"));
  });

  it("reports a document nothing has ever been written to as empty", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const documentId = await t.run((ctx) =>
      ctx.db.insert("documents", { workspaceId, name: "Brand new" }),
    );

    const stored = await asUser.query(api.snapshots.getStoredState, {
      resourceType: "doc",
      resourceId: documentId,
    });

    // Knowledge, not a failure: the client may open this offline.
    expect(stored).toEqual({ status: "empty" });
  });

  it("never says 'empty' to someone who may not read the resource", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t, "Owning Workspace");
    // No snapshot — so a naive implementation would answer "empty" here.
    const documentId = await t.run((ctx) =>
      ctx.db.insert("documents", { workspaceId, name: "Confidential" }),
    );

    const { asUser: asOutsider } = await setupWorkspaceWithAdmin(t, "Other Workspace");

    const stored = await asOutsider.query(api.snapshots.getStoredState, {
      resourceType: "doc",
      resourceId: documentId,
    });

    expect(stored).toEqual({ status: "unavailable" });
  });

  it("does not call a resource that no longer exists empty", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const documentId = await t.run((ctx) =>
      ctx.db.insert("documents", { workspaceId, name: "Doomed" }),
    );
    await t.run((ctx) => ctx.db.delete(documentId));

    const stored = await asUser.query(api.snapshots.getStoredState, {
      resourceType: "doc",
      resourceId: documentId,
    });

    expect(stored).toEqual({ status: "unavailable" });
  });

  it("agrees with getSnapshotUrl on every outcome", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const withSnapshot = await setupDocumentWithSnapshot(t, workspaceId);
    const withoutSnapshot = await t.run((ctx) =>
      ctx.db.insert("documents", { workspaceId, name: "Brand new" }),
    );

    for (const resourceId of [withSnapshot, withoutSnapshot]) {
      const url = await asUser.query(api.snapshots.getSnapshotUrl, {
        resourceType: "doc",
        resourceId,
      });
      const stored = await asUser.query(api.snapshots.getStoredState, {
        resourceType: "doc",
        resourceId,
      });
      expect(url).toBe(stored.status === "stored" ? stored.url : null);
    }
  });
});
