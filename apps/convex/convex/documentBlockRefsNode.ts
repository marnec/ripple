"use node";

import { v } from "convex/values";
import * as Y from "yjs";
import { internalAction, action } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  extractBlocksFromFragment,
  isEmbeddableBlockType,
  extractTextFromXml,
  type BlockPreview,
} from "@ripple/shared/blockRef";

/**
 * Populate a block ref cache entry from the Yjs snapshot stored in Convex.
 * Scheduled by ensureBlockRef after creating a placeholder.
 */
export const populateFromSnapshot = internalAction({
  args: {
    documentId: v.id("documents"),
    blockId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { documentId, blockId }) => {
    const doc = await ctx.runQuery(
      internal.documentBlockRefs.getDocumentInternal,
      { id: documentId },
    );
    if (!doc?.yjsSnapshotId) return null;

    const url = await ctx.storage.getUrl(doc.yjsSnapshotId);
    if (!url) return null;

    const response = await fetch(url);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();

    const yDoc = new Y.Doc();
    Y.applyUpdate(yDoc, new Uint8Array(arrayBuffer));
    const fragment = yDoc.getXmlFragment("document-store");

    // Find the specific block by ID
    const block = findBlockById(fragment, blockId);
    yDoc.destroy();

    if (!block) return null;

    await ctx.runMutation(internal.documentBlockRefs.upsertBlockContent, {
      documentId,
      updates: [
        {
          blockId,
          blockType: block.type,
          textContent: block.text,
        },
      ],
    });

    return null;
  },
});

/**
 * Load all embeddable blocks from a document's Yjs snapshot.
 * Called by the BlockPickerDialog to display block choices.
 */
export const getDocumentBlocks = action({
  args: { documentId: v.id("documents") },
  returns: v.array(
    v.object({
      blockId: v.string(),
      type: v.string(),
      text: v.string(),
      level: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, { documentId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const doc = await ctx.runQuery(
      internal.documentBlockRefs.getDocumentInternal,
      { id: documentId },
    );
    if (!doc?.yjsSnapshotId) return [];

    // Check workspace membership
    const membership = await ctx.runQuery(
      internal.documentBlockRefs.checkMembership,
      { workspaceId: doc.workspaceId, userId },
    );
    if (!membership) return [];

    const url = await ctx.storage.getUrl(doc.yjsSnapshotId);
    if (!url) return [];

    const response = await fetch(url);
    if (!response.ok) return [];
    const arrayBuffer = await response.arrayBuffer();

    const yDoc = new Y.Doc();
    Y.applyUpdate(yDoc, new Uint8Array(arrayBuffer));
    const fragment = yDoc.getXmlFragment("document-store");

    const blocks = extractBlocksFromFragment(fragment);
    yDoc.destroy();

    return blocks;
  },
});

/**
 * Find a specific block by ID in the Yjs XML fragment.
 */
function findBlockById(
  fragment: Y.XmlFragment,
  targetBlockId: string,
): BlockPreview | null {
  function walk(group: Y.XmlElement | Y.XmlFragment): BlockPreview | null {
    for (const child of group.toArray()) {
      const container = child as Y.XmlElement;
      if (container.nodeName === "blockContainer") {
        const blockId = container.getAttribute("id");
        if (blockId === targetBlockId) {
          const children = container.toArray();
          const contentElement = children[0] as Y.XmlElement | undefined;
          if (!contentElement?.nodeName) return null;
          if (!isEmbeddableBlockType(contentElement.nodeName)) return null;

          const text = extractTextFromXml(contentElement);
          const preview: BlockPreview = {
            blockId,
            type: contentElement.nodeName,
            text,
          };
          if (contentElement.nodeName === "heading") {
            const level = contentElement.getAttribute("level");
            if (level) preview.level = parseInt(level, 10);
          }
          return preview;
        }

        // Check nested blockGroup
        const nestedGroup = container.toArray()[1] as Y.XmlElement | undefined;
        if (nestedGroup?.nodeName === "blockGroup") {
          const found = walk(nestedGroup);
          if (found) return found;
        }
      } else if (container.nodeName === "blockGroup") {
        const found = walk(container);
        if (found) return found;
      }
    }
    return null;
  }

  return walk(fragment);
}
