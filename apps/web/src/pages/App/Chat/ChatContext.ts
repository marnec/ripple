import { createContext, useContext, type RefObject } from "react";
import { ConvexError } from "convex/values";
import type { Id } from "@convex/_generated/dataModel";

export type EditingMessage = { body: string | null; id: Id<"messages"> | null };

export type ReplyingToMessage = {
  id: Id<"messages">;
  author: string;
  plainText: string;
  body: string;
  imageUrl?: string;
} | null;

/** What a selected message contributes to "Create task": its title seed and order. */
export type SelectedMessage = {
  id: Id<"messages">;
  plainText: string;
  sentAt: number;
};

/** Ceiling on selected messages — `CAPTURE_MAX` on the server. */
export const MESSAGE_SELECTION_MAX = 50;

type ChatContextType = {
  editingMessage: EditingMessage;
  setEditingMessage: (msg: EditingMessage) => void;
  replyingTo: ReplyingToMessage;
  setReplyingTo: (msg: ReplyingToMessage) => void;
  /**
   * Files dropped anywhere on the chat pane.
   *
   * The drop target has to be the whole pane — dropping onto a 24px-tall
   * composer is not a feature anyone would find — but the attachment
   * lifecycle (preview, upload, the single slot) lives in the composer, which
   * is lazy-loaded below the message list. So the composer publishes its
   * handler here for as long as it is mounted, and `Chat` calls it. Null while
   * the composer chunk is still loading, in which case a drop is a no-op.
   */
  attachDroppedFilesRef: RefObject<((files: File[]) => void) | null>;
  /**
   * Messages picked for "Create task", or null outside selection mode. While
   * it is non-null a click on a message toggles it instead of acting on it,
   * and the selection bar stands in for the composer.
   */
  selection: ReadonlyMap<Id<"messages">, SelectedMessage> | null;
  /** Enter selection mode with `message` picked, or toggle it once in. */
  toggleSelected: (message: SelectedMessage) => void;
  clearSelection: () => void;
};

export const ChatContext = createContext<ChatContextType | null>(null);

export const useChatContext = () => {
  const context = useContext(ChatContext);
  if (!context) throw new ConvexError("useChatContext must be used within ChatProvider");
  return context;
};
