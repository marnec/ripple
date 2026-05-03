/**
 * Shared utilities for document block references.
 * Used by frontend, Convex backend (Node.js actions), and PartyKit server.
 */

/** Minimal preview of a document block, used by the block picker and cache. */
export interface BlockPreview {
  blockId: string;
  type: string;       // "paragraph", "heading", "bulletListItem", etc.
  text: string;       // plain text content
  level?: number;     // heading level (1-3)
}

/**
 * Block types that are allowed to be embedded.
 * Only pure text blocks — no diagrams, spreadsheets, embeds, tables, etc.
 */
const EMBEDDABLE_BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "quote",
]);

export function isEmbeddableBlockType(type: string): boolean {
  return EMBEDDABLE_BLOCK_TYPES.has(type);
}

/**
 * Extract plain text from a Yjs XmlElement recursively.
 * Handles XmlText nodes and nested XmlElements.
 */
export function extractTextFromXml(element: {
  toArray(): Array<unknown>;
  toString(): string;
}): string {
  const parts: string[] = [];
  for (const child of element.toArray()) {
    if (child && typeof child === "object" && "toString" in child) {
      // XmlText or XmlElement — both have toString()
      const text = (child as { toString(): string }).toString();
      if (text) parts.push(text);
    }
  }
  return parts.join("").replace(/<[^>]*>/g, ""); // strip any XML tags
}

/**
 * Extract blocks from a Yjs XML fragment (the "document-store" fragment).
 * Returns only top-level embeddable text blocks.
 *
 * BlockNote/ProseMirror Yjs structure:
 *   XmlFragment("document-store")
 *     └── XmlElement("blockGroup")
 *           └── XmlElement("blockContainer") [id=blockId]
 *                 ├── XmlElement("paragraph"|"heading"|...) ← content
 *                 └── XmlElement("blockGroup") ← children (ignored)
 */
export function extractBlocksFromFragment(
  fragment: {
    toArray(): Array<unknown>;
  },
): BlockPreview[] {
  const blocks: BlockPreview[] = [];

  function walkBlockGroup(group: { toArray(): Array<unknown> }): void {
    for (const child of group.toArray()) {
      const container = child as {
        nodeName?: string;
        getAttribute?(name: string): string | undefined;
        toArray(): Array<unknown>;
      };
      if (container.nodeName !== "blockContainer") continue;

      const blockId = container.getAttribute?.("id");
      if (!blockId) continue;

      // First child is the content element (paragraph, heading, etc.)
      const children = container.toArray();
      const contentElement = children[0] as {
        nodeName?: string;
        getAttribute?(name: string): string | undefined;
        toArray(): Array<unknown>;
        toString(): string;
      } | undefined;

      if (!contentElement?.nodeName) continue;

      const blockType = contentElement.nodeName;
      if (!isEmbeddableBlockType(blockType)) continue;

      const text = extractTextFromXml(contentElement);
      // Skip empty blocks
      if (!text.trim()) continue;

      const preview: BlockPreview = { blockId, type: blockType, text };

      // Extract heading level if applicable
      if (blockType === "heading") {
        const level = contentElement.getAttribute?.("level");
        if (level) preview.level = parseInt(level, 10);
      }

      blocks.push(preview);

      // Recurse into nested block groups (children)
      const nestedGroup = children[1] as {
        nodeName?: string;
        toArray(): Array<unknown>;
      } | undefined;
      if (nestedGroup?.nodeName === "blockGroup") {
        walkBlockGroup(nestedGroup);
      }
    }
  }

  // The fragment contains a single top-level blockGroup
  for (const topLevel of fragment.toArray()) {
    const group = topLevel as { nodeName?: string; toArray(): Array<unknown> };
    if (group.nodeName === "blockGroup") {
      walkBlockGroup(group);
    }
  }

  return blocks;
}
