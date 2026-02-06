/**
 * BlockNote JSON parser utilities
 */

type BlockNoteBlock = {
  type: string;
  content?: InlineContent[];
  children?: BlockNoteBlock[];
  [key: string]: unknown;
};

type InlineContent =
  | { type: "text"; text: string; styles: Record<string, unknown> }
  | { type: "link"; content: InlineContent[]; href: string }
  | { type: "userMention"; props: { userId: string } }
  | { type: string; [key: string]: unknown };

/**
 * Extract all mentioned user IDs from BlockNote JSON document
 * @param documentJson - BlockNote JSON string (as stored in task descriptions/comments)
 * @returns Array of unique user IDs found in userMention inline content nodes
 */
export function extractMentionedUserIds(documentJson: string): string[] {
  try {
    const blocks: BlockNoteBlock[] = JSON.parse(documentJson);
    const userIds = new Set<string>();

    function traverseBlocks(blocks: BlockNoteBlock[]): void {
      for (const block of blocks) {
        // Process inline content in current block
        if (block.content) {
          traverseInlineContent(block.content);
        }

        // Recursively process nested blocks
        if (block.children) {
          traverseBlocks(block.children);
        }
      }
    }

    function traverseInlineContent(content: InlineContent[]): void {
      for (const item of content) {
        if (item.type === "userMention") {
          // Type narrowing: check if this is a userMention type
          const mention = item as { type: "userMention"; props: { userId: string } };
          if (mention.props?.userId) {
            userIds.add(mention.props.userId);
          }
        }

        // Links can contain nested content with mentions
        if (item.type === "link") {
          const link = item as { type: "link"; content: InlineContent[]; href: string };
          if (Array.isArray(link.content)) {
            traverseInlineContent(link.content);
          }
        }
      }
    }

    traverseBlocks(blocks);
    return Array.from(userIds);
  } catch {
    // Gracefully handle parse failures - return empty array
    return [];
  }
}
