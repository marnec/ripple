import { Doc } from "../../convex/_generated/dataModel";

export interface ChannelMember extends Doc<"channelMembers"> {
  name: string;
}

export type ReplyToInfo = {
  author: string;
  plainText: string;
  deleted: boolean;
} | null;

export interface MessageWithAuthor extends Doc<"messages"> {
  author: string;
  replyTo: ReplyToInfo;
}
