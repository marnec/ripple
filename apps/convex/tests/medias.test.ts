import { describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import { createTestContext, setupAuthenticatedUser, setupWorkspaceWithAdmin } from "./helpers";
import { MESSAGE_FILE_ATTACHMENT_MAX_BYTES } from "@ripple/shared/constants";

/** Store `bytes` bytes in the deployment's blob storage and return the id. */
async function store(t: ReturnType<typeof createTestContext>, bytes: number) {
  return await t.run(async (ctx) => ctx.storage.store(new Blob([new Uint8Array(bytes)])));
}

describe("medias.saveMedia file attachments", () => {
  it("stores a file attachment and hands back its URL", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const storageId = await store(t, 32);

    const url = await asUser.mutation(api.medias.saveMedia, {
      storageId,
      workspaceId,
      fileName: "notes.txt",
      mimeType: "text/plain",
      size: 32,
      type: "file",
    });

    expect(url).toBeTruthy();
    const media = await t.run(async (ctx) =>
      ctx.db
        .query("medias")
        .withIndex("by_storage_id", (q) => q.eq("storageId", storageId))
        .unique(),
    );
    expect(media).toMatchObject({ type: "file", fileName: "notes.txt", workspaceId });
  });

  it("rejects an oversized file on the stored size, not the size the client claims", async () => {
    // The whole point of the check: a client that under-reports `size` must
    // not slip past it, so the cap is read off the storage row.
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const storageId = await store(t, MESSAGE_FILE_ATTACHMENT_MAX_BYTES + 1);

    await expect(
      asUser.mutation(api.medias.saveMedia, {
        storageId,
        workspaceId,
        fileName: "huge.bin",
        mimeType: "application/octet-stream",
        size: 10,
        type: "file",
      }),
    ).rejects.toThrow(ConvexError);

    // No `medias` row means the blob is an orphan by construction, which is
    // what leaves it to `storageGc` — the mutation cannot delete it itself
    // (the throw would roll the delete back with everything else).
    const media = await t.run(async (ctx) =>
      ctx.db
        .query("medias")
        .withIndex("by_storage_id", (q) => q.eq("storageId", storageId))
        .unique(),
    );
    expect(media).toBeNull();
  });

  it("leaves image uploads uncapped — they are thumbnailed, not stored raw into a message", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const storageId = await store(t, MESSAGE_FILE_ATTACHMENT_MAX_BYTES + 1);

    await expect(
      asUser.mutation(api.medias.saveMedia, {
        storageId,
        workspaceId,
        fileName: "huge.png",
        mimeType: "image/png",
        size: MESSAGE_FILE_ATTACHMENT_MAX_BYTES + 1,
        type: "image",
      }),
    ).resolves.toBeTruthy();
  });

  it("refuses a file attachment from a non-member of the workspace", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const outsider = await setupAuthenticatedUser(t, {
      name: "Outsider",
      email: "outsider@example.com",
    });
    const storageId = await store(t, 8);

    await expect(
      outsider.asUser.mutation(api.medias.saveMedia, {
        storageId,
        workspaceId,
        fileName: "notes.txt",
        mimeType: "text/plain",
        size: 8,
        type: "file",
      }),
    ).rejects.toThrow();
  });
});
