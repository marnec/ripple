import { createContext, useContext } from "react";
import { ConvexError } from "convex/values";
import { Id } from "../../../../convex/_generated/dataModel";

export type EditingMessage = { body: string | null; id: Id<"messages"> | null };

type EditingMessageContext = {
  editingMessage: EditingMessage;
  setEditingMessage: (msg: EditingMessage) => void;
};

export const ChatContext = createContext<EditingMessageContext | null>(null);

export const useChatContext = () => {
  const context = useContext(ChatContext);
  if (!context) throw new ConvexError("useChatContext must be used within ChatProvider");
  return context;
};
