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
  | { type: "resourceReference"; props: { resourceId: string; resourceType: string; resourceName: string; cellRef?: string } }
  | { type: "eventMention"; props: { eventId?: string; seriesId?: string } }
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
  eventTitles?: Map<string, string>,
): string {
  try {
    const blocks: BlockNoteBlock[] = JSON.parse(bodyJson);
    return blocksToPlainText(blocks, userNames, projectNames, eventTitles);
  } catch {
    return "";
  }
}

/**
 * The NOTIFICATION projection: what a reply preview and a lock screen say.
 *
 * `table` blocks contribute nothing on purpose. A frozen spreadsheet range is
 * headed by a `resourceReference` chip naming the sheet and the range, which is
 * what a preview wants; the cells themselves would be 97 characters of
 * pipe-separated numbers on a lock screen (see the truncation in `send`). The
 * client's `blocksToPlainText` DOES flatten them, because it composes the
 * `plainText` that `search` indexes — that divergence is intended.
 */
function blocksToPlainText(
  blocks: BlockNoteBlock[],
  userNames?: Map<string, string>,
  projectNames?: Map<string, string>,
  eventTitles?: Map<string, string>,
): string {
  const lines: string[] = [];
  for (const block of blocks) {
    let line = "";
    if (Array.isArray(block.content)) {
      line = inlineContentToPlainText(block.content, userNames, projectNames, eventTitles);
    }
    lines.push(line);
    if (block.children?.length) {
      lines.push(blocksToPlainText(block.children, userNames, projectNames, eventTitles));
    }
  }
  return lines.join("\n").trim();
}

function inlineContentToPlainText(
  content: InlineContent[],
  userNames?: Map<string, string>,
  projectNames?: Map<string, string>,
  eventTitles?: Map<string, string>,
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
          text += inlineContentToPlainText(link.content, userNames, projectNames, eventTitles);
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
      case "resourceReference": {
        const ref = item as {
          type: "resourceReference";
          props: { resourceName?: string; cellRef?: string };
        };
        text += `#${ref.props.resourceName || "resource"}`;
        if (ref.props.cellRef) text += ` \u203A ${ref.props.cellRef}`;
        break;
      }
      case "eventMention": {
        // One chip, two kinds of target — an event row or a series. Both are
        // titles the map may hold, and neither is more "the" mention than the
        // other, so the lookup takes whichever id the chip carries.
        const mention = item as {
          type: "eventMention";
          props: { eventId?: string; seriesId?: string };
        };
        const id = mention.props.eventId || mention.props.seriesId;
        const title = id ? eventTitles?.get(id) : undefined;
        text += `@${title || "event"}`;
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
 * Extract the ids referenced via eventMention in a BlockNote JSON document,
 * under one of the chip's two props.
 *
 * One inline type carries two kinds of target: `eventId` for a one-off event's
 * row, `seriesId` for a **series** (ADR 0002). They must be pulled out
 * separately because they live in different tables — every caller resolves
 * them against one table and would silently drop, or worse mislabel, the
 * other.
 */
function extractEventMentionProp(
  documentJson: string,
  prop: "eventId" | "seriesId",
): string[] {
  try {
    const blocks: BlockNoteBlock[] = JSON.parse(documentJson);
    const ids = new Set<string>();

    const collect = (item: InlineContent): void => {
      if (item.type !== "eventMention") return;
      const mention = item as {
        type: "eventMention";
        props: Partial<Record<"eventId" | "seriesId", string>>;
      };
      const id = mention.props?.[prop];
      if (id) ids.add(id);
    };

    function traverse(blocks: BlockNoteBlock[]): void {
      for (const block of blocks) {
        if (block.content) {
          for (const item of block.content) {
            collect(item);
            if (item.type === "link") {
              const link = item as { type: "link"; content: InlineContent[] };
              if (Array.isArray(link.content)) link.content.forEach(collect);
            }
          }
        }
        if (block.children) traverse(block.children);
      }
    }

    traverse(blocks);
    return Array.from(ids);
  } catch {
    return [];
  }
}

/**
 * Extract all event IDs referenced via eventMention in BlockNote JSON document.
 * @<event> mentions in chats, docs, task descriptions, and task comments.
 */
export function extractEventMentionIds(documentJson: string): string[] {
  return extractEventMentionProp(documentJson, "eventId");
}

/**
 * The same, for mentions of a **series**. Kept apart from the event ids for
 * the reason above: a series id resolved against `calendarEvents` is not found
 * and the chip goes dead, and an edge labelled `calendarEvent` pointing at a
 * series is a lie the graph would happily draw.
 */
export function extractEventSeriesMentionIds(documentJson: string): string[] {
  return extractEventMentionProp(documentJson, "seriesId");
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

/**
 * Extract all resource references (documents, diagrams, spreadsheets) from BlockNote JSON.
 * Returns array of { id, type } pairs.
 */
export function extractResourceReferenceIds(documentJson: string): Array<{ id: string; type: string }> {
  try {
    const blocks: BlockNoteBlock[] = JSON.parse(documentJson);
    const refs = new Map<string, string>(); // id → type (deduplicates)

    function traverse(blocks: BlockNoteBlock[]): void {
      for (const block of blocks) {
        if (block.content) {
          for (const item of block.content) {
            if (item.type === "resourceReference") {
              const ref = item as { type: "resourceReference"; props: { resourceId: string; resourceType: string } };
              if (ref.props?.resourceId) refs.set(ref.props.resourceId, ref.props.resourceType);
            }
            if (item.type === "link") {
              const link = item as { type: "link"; content: InlineContent[] };
              if (Array.isArray(link.content)) {
                for (const c of link.content) {
                  if (c.type === "resourceReference") {
                    const ref = c as { type: "resourceReference"; props: { resourceId: string; resourceType: string } };
                    if (ref.props?.resourceId) refs.set(ref.props.resourceId, ref.props.resourceType);
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
    return Array.from(refs.entries()).map(([id, type]) => ({ id, type }));
  } catch {
    return [];
  }
}

/** Everything a message body can point at. Mirrors `edges.targetType`. */
export type MessageTargetType =
  | "user"
  | "task"
  | "project"
  | "document"
  | "diagram"
  | "spreadsheet"
  | "calendarEvent"
  | "eventSeries";

/**
 * Extract all reference targets from a message body (users, tasks, projects, resources).
 * Pure function — no DB access.
 */
export function extractMessageTargets(body: string): Array<{ targetType: MessageTargetType; targetId: string }> {
  const targets: Array<{ targetType: MessageTargetType; targetId: string }> = [];
  const seen = new Set<string>();

  const add = (targetType: MessageTargetType, targetId: string) => {
    if (!seen.has(targetId)) {
      seen.add(targetId);
      targets.push({ targetType, targetId });
    }
  };

  for (const userId of extractMentionedUserIds(body)) add("user", userId);
  for (const taskId of extractTaskMentionIds(body)) add("task", taskId);
  for (const projectId of extractProjectIds(body)) add("project", projectId);
  for (const eventId of extractEventMentionIds(body)) add("calendarEvent", eventId);
  // A mention of the ritual rather than of one Tuesday. Its own target type,
  // so the graph link says what it points at.
  for (const seriesId of extractEventSeriesMentionIds(body)) add("eventSeries", seriesId);
  for (const ref of extractResourceReferenceIds(body)) {
    add(ref.type as "document" | "diagram" | "spreadsheet", ref.id);
  }

  return targets;
}
