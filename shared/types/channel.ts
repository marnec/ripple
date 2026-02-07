import { Doc } from "../../convex/_generated/dataModel";

export interface ChannelMember extends Doc<"channelMembers"> {
  name: string;
}

export type ReplyToInfo = {
  author: string;
  plainText: string;
  deleted: boolean;
} | null;

export type MentionedUser = { name: string | null; email?: string | null; image?: string };
export type MentionedTask = { title: string; projectId: string; statusColor?: string };
export type MentionedProject = { name: string; color: string };

export interface MessageWithAuthor extends Doc<"messages"> {
  author: string;
  replyTo: ReplyToInfo;
  mentionedUsers: Record<string, MentionedUser>;
  mentionedTasks: Record<string, MentionedTask>;
  mentionedProjects: Record<string, MentionedProject>;
}
