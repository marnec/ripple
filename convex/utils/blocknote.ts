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
  | { type: "taskMention"; props: { taskId: string; taskTitle?: string } }
  | { type: "projectReference"; props: { projectId: string } }
  | { type: string; [key: string]: unknown };

/**
 * Extract plain text from BlockNote JSON body, including mention text.
 * @param bodyJson - BlockNote JSON string
 * @param userNames - Map of userId → display name (for @mentions)
 * @param projectNames - Map of projectId → display name (for #project references)
 */
export function extractPlainTextFromBody(
  bodyJson: string,
  userNames?: Map<string, string>,
  projectNames?: Map<string, string>,
): string {
  try {
    const blocks: BlockNoteBlock[] = JSON.parse(bodyJson);
    return blocksToPlainText(blocks, userNames, projectNames);
  } catch {
    return "";
  }
}

function blocksToPlainText(
  blocks: BlockNoteBlock[],
  userNames?: Map<string, string>,
  projectNames?: Map<string, string>,
): string {
  const lines: string[] = [];
  for (const block of blocks) {
    let line = "";
    if (Array.isArray(block.content)) {
      line = inlineContentToPlainText(block.content, userNames, projectNames);
    }
    lines.push(line);
    if (block.children?.length) {
      lines.push(blocksToPlainText(block.children, userNames, projectNames));
    }
  }
  return lines.join("\n").trim();
}

function inlineContentToPlainText(
  content: InlineContent[],
  userNames?: Map<string, string>,
  projectNames?: Map<string, string>,
): string {
  let text = "";
  for (const item of content) {
    switch (item.type) {
      case "text":
        text += (item as { type: "text"; text: string }).text;
        break;
      case "link": {
        const link = item as { type: "link"; content: InlineContent[] };
        if (Array.isArray(link.content)) {
          text += inlineContentToPlainText(link.content, userNames, projectNames);
        }
        break;
      }
      case "taskMention": {
        const mention = item as { type: "taskMention"; props: { taskTitle?: string } };
        text += `#${mention.props.taskTitle || "task"}`;
        break;
      }
      case "userMention": {
        const mention = item as { type: "userMention"; props: { userId: string } };
        const name = userNames?.get(mention.props.userId);
        text += `@${name || "user"}`;
        break;
      }
      case "projectReference": {
        const mention = item as { type: "projectReference"; props: { projectId: string } };
        const name = projectNames?.get(mention.props.projectId);
        text += `#${name || "project"}`;
        break;
      }
    }
  }
  return text;
}

/**
 * Extract all project IDs referenced in BlockNote JSON document
 */
export function extractProjectIds(documentJson: string): string[] {
  try {
    const blocks: BlockNoteBlock[] = JSON.parse(documentJson);
    const projectIds = new Set<string>();

    function traverse(blocks: BlockNoteBlock[]): void {
      for (const block of blocks) {
        if (block.content) {
          for (const item of block.content) {
            if (item.type === "projectReference") {
              const ref = item as { type: "projectReference"; props: { projectId: string } };
              if (ref.props?.projectId) projectIds.add(ref.props.projectId);
            }
            if (item.type === "link") {
              const link = item as { type: "link"; content: InlineContent[] };
              if (Array.isArray(link.content)) {
                for (const c of link.content) {
                  if (c.type === "projectReference") {
                    const ref = c as { type: "projectReference"; props: { projectId: string } };
                    if (ref.props?.projectId) projectIds.add(ref.props.projectId);
                  }
                }
              }
            }
          }
        }
        if (block.children) traverse(block.children);
      }
    }

    traverse(blocks);
    return Array.from(projectIds);
  } catch {
    return [];
  }
}

/**
 * Extract all task IDs referenced via taskMention in BlockNote JSON document
 */
export function extractTaskMentionIds(documentJson: string): string[] {
  try {
    const blocks: BlockNoteBlock[] = JSON.parse(documentJson);
    const taskIds = new Set<string>();

    function traverse(blocks: BlockNoteBlock[]): void {
      for (const block of blocks) {
        if (block.content) {
          for (const item of block.content) {
            if (item.type === "taskMention") {
              const mention = item as { type: "taskMention"; props: { taskId: string } };
              if (mention.props?.taskId) taskIds.add(mention.props.taskId);
            }
            if (item.type === "link") {
              const link = item as { type: "link"; content: InlineContent[] };
              if (Array.isArray(link.content)) {
                for (const c of link.content) {
                  if (c.type === "taskMention") {
                    const mention = c as { type: "taskMention"; props: { taskId: string } };
                    if (mention.props?.taskId) taskIds.add(mention.props.taskId);
                  }
                }
              }
            }
          }
        }
        if (block.children) traverse(block.children);
      }
    }

    traverse(blocks);
    return Array.from(taskIds);
  } catch {
    return [];
  }
}

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
