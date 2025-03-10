import { Doc } from "../../convex/_generated/dataModel";

export interface ChannelMember extends Doc<"channelMembers"> {
  name: string;
}

export interface MessageWithAuthor extends Doc<"messages"> {
  author: string;
}
