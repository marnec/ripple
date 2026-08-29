import { ChannelKind, ChannelVisibility } from "./enums/roles";

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
type ChannelLike = { kind?: string; visibility?: string };

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
