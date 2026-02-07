import { createContext, useContext } from "react";
import { ConvexError } from "convex/values";
import { Id } from "../../../../convex/_generated/dataModel";

export type EditingMessage = { body: string | null; id: Id<"messages"> | null };

export type ReplyingToMessage = {
  id: Id<"messages">;
  author: string;
  plainText: string;
} | null;

type ChatContextType = {
  editingMessage: EditingMessage;
  setEditingMessage: (msg: EditingMessage) => void;
  replyingTo: ReplyingToMessage;
  setReplyingTo: (msg: ReplyingToMessage) => void;
};

export const ChatContext = createContext<ChatContextType | null>(null);

export const useChatContext = () => {
  const context = useContext(ChatContext);
  if (!context) throw new ConvexError("useChatContext must be used within ChatProvider");
  return context;
};
