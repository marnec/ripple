import { isDirectMessage, type ChannelLike } from "@ripple/shared/channel";

/**
 * The words for the exit control — what `exitAction` decides, said out loud.
 *
 * Split from the predicate the way `channel-visibility.ts` is: the shared
 * package owns the shape (three actions, closed set), each app owns the copy.
 * `packages/shared` carries no user-facing English, and the backend's one
 * dismissal string is a developer-facing throw rather than UI text.
 *
 * Keyed by **kind**, not by action, because the action does not determine the
 * wording: dismissing a direct message is "closing" it and dismissing a public
 * channel is "hiding" it. Those four strings were previously written out at
 * each of the three sites that render them, as `isDm ? … : …` ternaries — the
 * settings rail, the channel menu, and the DM menu — which is how the settings
 * page ended up offering "Close conversation" with no way to reopen it.
 */
interface ExitCopy {
  /** Short label for the settings rail tab. */
  tab: string;
  /** The control that dismisses. */
  dismiss: string;
  /** The control that undoes a dismissal. */
  restore: string;
  /** Toast titles. The body is always the server's message. */
  dismissFailed: string;
  restoreFailed: string;
  /** What dismissal actually does, for the settings page's explanatory copy. */
  explanation: string;
}

const DM_EXIT_COPY: ExitCopy = {
  tab: "Close",
  dismiss: "Close conversation",
  restore: "Reopen conversation",
  dismissFailed: "Couldn't close conversation",
  restoreFailed: "Couldn't reopen conversation",
  explanation:
    "This removes the conversation from your sidebar. Nothing is deleted and the other person is not notified — it comes back on their next message.",
};

const CHANNEL_EXIT_COPY: ExitCopy = {
  tab: "Hide",
  dismiss: "Hide from sidebar",
  restore: "Show in sidebar",
  dismissFailed: "Couldn't hide channel",
  restoreFailed: "Couldn't unhide channel",
  explanation:
    "This removes the channel from your sidebar, for you only. Nothing is deleted and nobody else is affected — you stay a member, and the eye toggle beside the sidebar's Channels heading brings it back.",
};

/** The dismissal wording for this conversation. */
export function exitCopy(channel: ChannelLike): ExitCopy {
  return isDirectMessage(channel) ? DM_EXIT_COPY : CHANNEL_EXIT_COPY;
}

/**
 * Leaving reads the same whatever the channel — only a private channel can be
 * left, so there is no kind to branch on.
 */
export const LEAVE_COPY = {
  tab: "Leave",
  action: "Leave channel",
} as const;
