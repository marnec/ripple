import { getUserDisplayName } from "@ripple/shared/displayName";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

import { isDirectMessage } from "@ripple/shared/channel";
/**
 * A DM's display label, derived from its participants.
 *
 * This used to be materialized onto `channels.name`, because that column backs
 * `channels.searchIndex("by_name")` and a search index can only index a stored
 * field. A stored label then has to be kept fresh, which is what the rename
 * fan-out job existed to do. Now that a DM is not workspace-wide discoverable
 * there is no index to feed, so the label is computed where it is shown and
 * there is nothing to keep in sync.
 *
 * Two forms, because the codebase genuinely needs both and used to disagree
 * about which was canonical: a DM in *your* sidebar is labelled with the other
 * person, while a transcript title or a share name has no viewer to be
 * relative to.
 */

/**
 * How many participants a label will name.
 *
 * A DM holds exactly two people: `createDm` inserts both and never more, and
 * `channelMembers.addToChannel` rejects a DM outright ("Cannot add members to
 * a DM"). This bound is slack against that invariant, not a guess — but it is
 * a real bound rather than a `.collect()`, because a label is read on every
 * sidebar render and an unbounded read there is the defect the
 * `no-collect-in-query` rule exists to catch.
 */
const MAX_LABELLED_PARTICIPANTS = 8;

async function participantNames(
  ctx: QueryCtx,
  channelId: Id<"channels">,
  excludeUserId?: Id<"users">,
): Promise<{ names: string[]; overflow: number }> {
  // One more than we will render, so overflow is detected rather than assumed
  // away. If the DM invariant above ever changes, the label says so instead of
  // silently dropping people.
  const members = await ctx.db
    .query("channelMembers")
    .withIndex("by_channel", (q) => q.eq("channelId", channelId))
    .take(MAX_LABELLED_PARTICIPANTS + 2);

  const others = members.filter((m) => m.userId !== excludeUserId);
  const shown = others.slice(0, MAX_LABELLED_PARTICIPANTS);

  const names = await Promise.all(
    shown.map(async (m) => getUserDisplayName(await ctx.db.get(m.userId))),
  );
  return { names: names.sort(), overflow: others.length - shown.length };
}

function render({ names, overflow }: { names: string[]; overflow: number }): string {
  if (names.length === 0) return "Unknown";
  const label = names.join(" × ");
  return overflow > 0 ? `${label} +${overflow}` : label;
}

/**
 * The label for a DM as seen by `viewerId` — the other participant(s).
 *
 * "You × Bob" is not how a person thinks about their own conversation list,
 * and it was never what the sidebar rendered.
 */
export async function dmLabelForViewer(
  ctx: QueryCtx,
  channelId: Id<"channels">,
  viewerId: Id<"users">,
): Promise<string> {
  return render(await participantNames(ctx, channelId, viewerId));
}

/**
 * The viewer-independent label, `<A> × <B>`, sorted so both participants see
 * the same string. For contexts with no viewer to be relative to.
 */
export async function dmLabelFull(
  ctx: QueryCtx,
  channelId: Id<"channels">,
): Promise<string> {
  return render(await participantNames(ctx, channelId));
}

/**
 * What to *call* a conversation: its stored name, or — for a direct message,
 * which stores none — the derived label.
 *
 * The one place the kind dispatch happens. It used to be written out at four
 * call sites and forgotten at two more, where a DM's breadcrumb rendered as an
 * empty string. `channelLabelForViewer` existed for exactly this and had zero
 * callers while its body was inlined beside it.
 *
 * Omit `viewerId` when there is nobody for the label to be relative to — a
 * share link read by a guest, a transcript title. One optional argument rather
 * than a `ForViewer`/`Full` pair at this layer: the pair below is two functions
 * because the distinction is the primitive; up here it would be two chances to
 * pick the wrong one at every call site.
 */
export async function channelLabel(
  ctx: QueryCtx,
  channel: { _id: Id<"channels">; name: string; kind?: string },
  viewerId?: Id<"users">,
): Promise<string> {
  if (!isDirectMessage(channel)) return channel.name;
  return viewerId === undefined
    ? await dmLabelFull(ctx, channel._id)
    : await dmLabelForViewer(ctx, channel._id, viewerId);
}
