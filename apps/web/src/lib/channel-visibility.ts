import { ChannelVisibility } from "@ripple/shared/enums";

/**
 * A **channel**'s visibility — who in the workspace may enter it.
 *
 * A **direct message** is not a third value here. It has no visibility to set:
 * no roster to manage, no join request, no settings page. Its row does store
 * `visibility: "private"`, but that is an inert derived constant — see
 * `CONTEXT.md` and `docs/adr/0001`.
 */
export type ChannelVisibilityValue =
  (typeof ChannelVisibility)[keyof typeof ChannelVisibility];

export const CHANNEL_VISIBILITIES: readonly ChannelVisibilityValue[] = [
  ChannelVisibility.PUBLIC,
  ChannelVisibility.PRIVATE,
];

/**
 * The single translation from the stored value to the word a member reads.
 *
 * Now barely a translation at all — the store and the UI finally say the same
 * word, and this is a capitalisation. It stays because it is also where the
 * ordering of the visibility picker lives, and because one map is what kept
 * the create dialog and the browse filter from drifting apart again.
 */
export const CHANNEL_VISIBILITY_LABEL: Record<ChannelVisibilityValue, string> = {
  [ChannelVisibility.PUBLIC]: "Public",
  [ChannelVisibility.PRIVATE]: "Private",
};

/**
 * What each visibility actually means. This is the part that carries the
 * meaning: "Private" reads as *secret*, and it is not — a private channel is
 * visible to the whole workspace and can be asked to join.
 */
export const CHANNEL_VISIBILITY_DESCRIPTION: Record<ChannelVisibilityValue, string> = {
  [ChannelVisibility.PUBLIC]: "Anyone in the workspace can view and join this channel.",
  [ChannelVisibility.PRIVATE]:
    "Only invited members can participate. All workspace members can see this channel exists.",
};
