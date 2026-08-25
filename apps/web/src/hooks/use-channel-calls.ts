import { usePresence } from "@/contexts/WorkspacePresenceContext";
import type { PresenceEntry } from "./use-workspace-presence";

export interface ChannelCallParticipant {
  userId: string;
  userName: string;
  userImage: string | null;
}

/**
 * Group presence entries by the channel call each user is in.
 *
 * Exported separately from the hook so the grouping is unit-testable without a
 * WebSocket or a provider tree.
 */
export function groupCallsByChannel(
  entries: Iterable<PresenceEntry>,
): Map<string, ChannelCallParticipant[]> {
  const calls = new Map<string, ChannelCallParticipant[]>();

  for (const entry of entries) {
    if (!entry.callChannelId) continue;
    const participants = calls.get(entry.callChannelId) ?? [];
    participants.push({
      userId: entry.userId,
      userName: entry.userName,
      userImage: entry.userImage,
    });
    calls.set(entry.callChannelId, participants);
  }

  // Stable order so a re-render doesn't reshuffle the tooltip's name list.
  for (const participants of calls.values()) {
    participants.sort((a, b) => a.userId.localeCompare(b.userId));
  }

  return calls;
}

/**
 * Live channel calls, as reported by the workspace presence room.
 *
 * The source is presence rather than the `callSessions` table on purpose. A
 * session row is only flipped inactive by `endSession`, which the client calls
 * when the last participant leaves *cleanly* — a closed tab, a crash, or a
 * dropped connection leaves it `active: true` with nobody in it, and no cron or
 * webhook ever reaps it. Reading that row would light a channel up forever.
 * Presence is scoped to a live WebSocket, so a participant who vanishes stops
 * being reported within one disconnect.
 *
 * The one thing it does not see is a guest who joined through a share link:
 * guests never enter the presence room. A call attended only by guests shows no
 * indicator, which is the right call for a workspace-member-facing sidebar.
 *
 * Costs nothing extra — the workspace presence socket is already open for
 * follow mode, and this is a filter over the map it already maintains.
 */
export function useChannelCalls(): Map<string, ChannelCallParticipant[]> {
  const { presenceMap } = usePresence();
  return groupCallsByChannel(presenceMap.values());
}
