import { MessageWithAuthor } from "@shared/types/channel";

export type GroupPosition = "solo" | "first" | "middle" | "last";

export type MessageGroupInfo = {
  position: GroupPosition;
  /** Show author name (first/solo for other people's messages) */
  showAuthor: boolean;
  /** Show timestamp (first/solo) */
  showTimestamp: boolean;
};

const GROUP_TIME_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes

function shouldBreakGroup(a: MessageWithAuthor, b: MessageWithAuthor): boolean {
  // Different author
  if (a.userId !== b.userId) return true;
  // Time gap exceeds threshold
  if (Math.abs(a._creationTime - b._creationTime) > GROUP_TIME_THRESHOLD_MS) return true;
  // Different day
  if (new Date(a._creationTime).toDateString() !== new Date(b._creationTime).toDateString()) return true;
  // Reply messages start a new group
  if (b.replyToId) return true;
  // Deleted messages break groups
  if (a.deleted || b.deleted) return true;
  return false;
}

/**
 * Compute grouping metadata for a DESC array of messages (newest first).
 * Position labels reflect VISUAL order (first = top of group, last = bottom).
 */
export function computeGroupPositions(
  messages: MessageWithAuthor[],
  currentUserId: string | undefined,
): MessageGroupInfo[] {
  if (!messages.length) return [];

  return messages.map((message, i) => {
    const prev = messages[i - 1]; // newer message (visually below)
    const next = messages[i + 1]; // older message (visually above)

    const sameAsPrev = prev ? !shouldBreakGroup(prev, message) : false;
    const sameAsNext = next ? !shouldBreakGroup(message, next) : false;

    // In DESC order: no sameAsNext = top of visual group = "first"
    //                no sameAsPrev = bottom of visual group = "last"
    let position: GroupPosition;
    if (!sameAsPrev && !sameAsNext) position = "solo";
    else if (sameAsPrev && !sameAsNext) position = "first";
    else if (sameAsPrev && sameAsNext) position = "middle";
    else position = "last"; // !sameAsPrev && sameAsNext

    const isOwn = message.userId === currentUserId;

    return {
      position,
      showAuthor: (position === "solo" || position === "first") && !isOwn,
      showTimestamp: position === "solo" || position === "first",
    };
  });
}
