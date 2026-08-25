import type { Doc } from "../_generated/dataModel";

export interface ChannelMember extends Doc<"channelMembers"> {
  name: string;
}

export type ReplyToInfo = {
  author: string;
  plainText: string;
  deleted: boolean;
  imageUrl?: string;
} | null;

// No `email` — see `enrichWithMentionedUsers`. Mention ids are client-authored,
// so this record must not carry more than `users.get` gives to any id-holder.
export type MentionedUser = { name: string | null; image?: string };
export type MentionedTask = { title: string; projectId: string; statusColor?: string };
export type MentionedProject = { name: string; color: string };
export type MentionedResource = { name: string; type: "document" | "diagram" | "spreadsheet" };
// `deleted: true` means the event was cancelled or is cross-workspace; in
// that case the chip renders a strikethrough fallback with no title leaked.
export type MentionedEvent = {
  title?: string;
  startsAt?: number;
  endsAt?: number;
  deleted: boolean;
};

// Reactions ride on the message rather than arriving from a second query keyed
// by message ids — see `enrichWithReactions`. `currentUserReacted` is resolved
// per viewer server-side, so this shape is already viewer-specific.
export type MessageReaction = {
  emoji: string;
  emojiNative: string;
  count: number;
  userIds: string[];
  currentUserReacted: boolean;
};

export interface MessageWithAuthor extends Doc<"messages"> {
  author: string;
  authorImage?: string;
  replyTo: ReplyToInfo;
  mentionedUsers: Record<string, MentionedUser>;
  mentionedTasks: Record<string, MentionedTask>;
  mentionedProjects: Record<string, MentionedProject>;
  mentionedResources: Record<string, MentionedResource>;
  mentionedEvents: Record<string, MentionedEvent>;
  reactions: MessageReaction[];
}
