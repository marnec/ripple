/**
 * The two axes a conversation lives on, as predicates.
 *
 * A `channels` row answers two unrelated questions — *what kind of thing is
 * this* (a **channel**, or a **direct message**) and *who may enter it*
 * (**public**, or **private**) — through one stored column that cannot tell
 * them apart. These predicates say which question is being asked, at every
 * site that asks one. See `CONTEXT.md` and `docs/adr/0001`.
 *
 * `isPublicChannel` and `isPrivateChannel` are **not** negations of each other.
 * Both are false for a direct message. Note that a DM row *does* store
 * `visibility: "private"` — an inert derived constant, not a setting — which is
 * exactly why both predicates check `kind` first. Without that check,
 * `isPrivateChannel` would be true for every conversation, and "refuse this for
 * private channels" would silently refuse it for direct messages too. That is
 * the trap this module exists to make unwritable.
 *
 * `!isPublicChannel(c)` is the membership gate: everything that is not a public
 * channel — private channels and direct messages alike — requires a
 * `channelMembers` row.
 */
import { ChannelKind, ChannelVisibility } from "./enums/roles";

/**
 * The two columns every predicate here reads, structurally. Exported so that
 * callers taking "something channel-shaped" — `channelDismissal.isDismissed`
 * is one — name the same contract instead of respelling it.
 */
export type ChannelLike = { kind?: string; visibility?: string };

/** A conversation between two people, rather than a channel. The *kind* axis. */
export function isDirectMessage(channel: ChannelLike): boolean {
  return channel.kind === ChannelKind.DM;
}

/** A channel any workspace member may read and join. The *visibility* axis. */
export function isPublicChannel(channel: ChannelLike): boolean {
  return channel.kind === ChannelKind.CHANNEL && channel.visibility === ChannelVisibility.PUBLIC;
}

/**
 * A channel whose members are invited, or who ask via a join request. The
 * *visibility* axis — never true for a direct message.
 */
export function isPrivateChannel(channel: ChannelLike): boolean {
  return channel.kind === ChannelKind.CHANNEL && channel.visibility === ChannelVisibility.PRIVATE;
}

/**
 * How a viewer gets a conversation out of their sidebar: they **dismiss** it,
 * they **leave** it, or neither is offered.
 *
 * One value out of a closed set rather than a pair of booleans, because
 * `canDismiss` / `canLeave` are not independent — exactly one of them is true
 * for any conversation a viewer can act on, and spelling that as two
 * predicates is what let the second one drift into a double negation
 * (`!isDm && !isPublicChannel(channel)`) at the one site that needed
 * `isPrivateChannel`.
 *
 * `isMember` is required, not optional, because "leave" is the one answer that
 * is not a property of the channel: there is nothing to leave without a
 * `channelMembers` row. A caller reading a list that is *built* from
 * memberships passes `true` and says so.
 *
 * An unrecognised row — `kind` absent, as on anything predating
 * `docs/adr/0001` — yields `"none"`. Offering no exit is recoverable; offering
 * the wrong one is not.
 */
export type ExitAction = "dismiss" | "leave" | "none";

export function exitAction(
  channel: ChannelLike,
  { isMember }: { isMember: boolean },
): ExitAction {
  // A direct message can be neither deleted nor left, so dismissal is its
  // whole lifecycle. A public channel has no roster to leave — dismissal is
  // the only way to decline one.
  if (isDirectMessage(channel) || isPublicChannel(channel)) return "dismiss";
  if (isPrivateChannel(channel)) return isMember ? "leave" : "none";
  return "none";
}
