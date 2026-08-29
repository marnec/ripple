import { isDirectMessage, type ChannelLike } from "@ripple/shared/channel";

/**
 * Which sidebar section a conversation belongs to.
 *
 * The partition is `kind`, and only `kind` — a **channel** is configurable and
 * browsable, a **direct message** is neither. See `CONTEXT.md`.
 */
export type ConversationSection = "channels" | "dms";

export function sectionOf(channel: ChannelLike): ConversationSection {
  return isDirectMessage(channel) ? "dms" : "channels";
}

/**
 * Split one sidebar section's conversations into what it renders and how many
 * it is holding back.
 *
 * Both halves are per-section on purpose. The server used to filter dismissed
 * rows out behind an `includeHidden` argument and report a single
 * `hiddenChannelCount` spanning *both* sections — so closing a direct message
 * incremented the count on the **Channels** header, and the Channels section's
 * eye toggle was the only control that could bring that conversation back. A
 * count that describes one section and is rendered by another is not a
 * cosmetic mismatch; it was the only route to the hidden item.
 *
 * Pure, and separate from the component, because this is the part that was
 * wrong — a render test would prove the toggle draws, not that it counts the
 * right rows.
 */
export function partitionSection<T extends { isHidden: boolean }>(
  conversations: T[] | undefined,
  { includeHidden }: { includeHidden: boolean },
): { visible: T[]; hiddenCount: number } {
  const all = conversations ?? [];
  return {
    visible: includeHidden ? all : all.filter((c) => !c.isHidden),
    hiddenCount: all.filter((c) => c.isHidden).length,
  };
}
