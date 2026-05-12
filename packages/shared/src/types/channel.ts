import { Doc } from "@ripple/convex/_generated/dataModel";

export interface ChannelMember extends Doc<"channelMembers"> {
  name: string;
}

export type ReplyToInfo = {
  author: string;
  plainText: string;
  deleted: boolean;
  imageUrl?: string;
} | null;

export type MentionedUser = { name: string | null; email?: string | null; image?: string };
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

export interface MessageWithAuthor extends Doc<"messages"> {
  author: string;
  authorImage?: string;
  replyTo: ReplyToInfo;
  mentionedUsers: Record<string, MentionedUser>;
  mentionedTasks: Record<string, MentionedTask>;
  mentionedProjects: Record<string, MentionedProject>;
  mentionedResources: Record<string, MentionedResource>;
  mentionedEvents: Record<string, MentionedEvent>;
}
