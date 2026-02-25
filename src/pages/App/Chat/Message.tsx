import { UserContext } from "@/pages/App/UserContext";
import { cn } from "@/lib/utils";
import { MessageWithAuthor } from "@shared/types/channel";
import { useMutation } from "convex/react";
import { CornerUpLeft, Loader2, Pencil, Plus, Trash2, X as XIcon } from "lucide-react";
import React, { Suspense, useCallback, useContext, useMemo, useRef, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "../../../components/ui/context-menu";
import { Dialog, DialogOverlay, DialogPortal } from "../../../components/ui/dialog";
import { useChatContext } from "./ChatContext";
import { MentionedUsersContext, MentionedTasksContext, MentionedProjectsContext, MentionedResourcesContext } from "./MentionedUsersContext";
import { MessageReactions } from "./MessageReactions";
import { MessageRenderer } from "./MessageRenderer";
import { hasImageBlocks } from "./messageUtils";
import { MessageQuotePreview } from "./MessageQuotePreview";

const EmojiPicker = React.lazy(() => import("emoji-picker-react"));

const QUICK_EMOJIS = [
  { unified: "2764-fe0f", native: "\u2764\uFE0F" },
  { unified: "1f44d", native: "\uD83D\uDC4D" },
  { unified: "1f602", native: "\uD83D\uDE02" },
  { unified: "1f525", native: "\uD83D\uDD25" },
  { unified: "1f622", native: "\uD83D\uDE22" },
  { unified: "1f389", native: "\uD83C\uDF89" },
];

type MessageProps = {
  message: MessageWithAuthor;
};

export function Message({ message }: MessageProps) {
  const { author, body, userId, _creationTime } = message;
  const user = useContext(UserContext);

  const userIsAuthor = userId === user?._id;
  const messageRef = useRef<HTMLLIElement>(null);

  const { setEditingMessage, setReplyingTo } = useChatContext()
  const deleteMessage = useMutation(api.messages.remove)
  const toggleReaction = useMutation(api.messageReactions.toggle);

  const handleReply = useCallback(() => {
    // Clear edit mode (mutually exclusive)
    setEditingMessage({ id: null, body: null });
    // Enter reply mode
    setReplyingTo({
      id: message._id,
      author: message.author,
      plainText: message.plainText,
      body: message.body,
    });
  }, [message, setEditingMessage, setReplyingTo]);

  const handleEdit = useCallback(() => {
    setReplyingTo(null); // Clear reply mode (mutually exclusive)
    setEditingMessage({ id: message._id, body: message.body });
  }, [message, setEditingMessage, setReplyingTo]);

  const handleDelete = useCallback(() => void deleteMessage({ id: message._id }), [message, deleteMessage])

  const handleQuickReaction = useCallback(
    (unified: string, native: string) => {
      void toggleReaction({ messageId: message._id, emoji: unified, emojiNative: native });
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    },
    [message._id, toggleReaction],
  );

  const handleEmojiClick = useCallback(
    (emojiData: { unified: string; emoji: string }) => {
      void toggleReaction({ messageId: message._id, emoji: emojiData.unified, emojiNative: emojiData.emoji });
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    },
    [message._id, toggleReaction],
  );

  const blocks = useMemo(() => JSON.parse(body), [body]);
  const messageHasImages = useMemo(() => hasImageBlocks(blocks), [blocks]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  return (
    <>
      <ContextMenu>
        <li
          ref={messageRef}
          className={cn(
            "flex flex-col text-sm animate-slide-up",
            userIsAuthor ? "items-end" : "items-start",
          )}
        >
          <div
            className={cn("flex items-center gap-3", userIsAuthor ? "flex-row" : "flex-row-reverse")}
          >
            <div className="mb-1 text-xs text-muted-foreground/70">{new Date(_creationTime).toLocaleTimeString(undefined, { timeStyle: 'short' })}</div>
            <div className="mb-1 text-sm font-medium">{author}</div>
          </div>

          <ContextMenuTrigger className="w-full">
            <MentionedUsersContext.Provider value={message.mentionedUsers ?? {}}>
            <MentionedTasksContext.Provider value={message.mentionedTasks ?? {}}>
            <MentionedProjectsContext.Provider value={message.mentionedProjects ?? {}}>
            <MentionedResourcesContext.Provider value={message.mentionedResources ?? {}}>
              <div
                className={cn(
                  "max-w-[85%] w-fit rounded-xl bg-muted transition-all",
                  userIsAuthor ? "rounded-tr-none ml-auto" : "rounded-tl-none",
                  messageHasImages ? "overflow-hidden" : "px-3 py-2",
                )}
              >
                {message.replyToId && (
                  <div className={messageHasImages ? "px-3 pt-2" : undefined}>
                    <MessageQuotePreview message={message.replyTo ?? null} compact />
                  </div>
                )}
                <MessageRenderer blocks={blocks} onImageClick={setLightboxUrl} />
              </div>
            </MentionedResourcesContext.Provider>
            </MentionedProjectsContext.Provider>
            </MentionedTasksContext.Provider>
            </MentionedUsersContext.Provider>
          </ContextMenuTrigger>

          <MessageReactions messageId={message._id} />
        </li>
        <ContextMenuContent className="w-56">
          {/* Quick reaction row */}
          <div className="flex items-center justify-center gap-0.5 px-1.5 py-1.5">
            {QUICK_EMOJIS.map(({ unified, native }) => (
              <button
                key={unified}
                onClick={() => handleQuickReaction(unified, native)}
                className="cursor-pointer rounded-md p-1 text-base transition-colors hover:bg-accent"
              >
                {native}
              </button>
            ))}
            <ContextMenuSub>
              <ContextMenuSubTrigger className="inline-flex h-7 w-7 items-center justify-center rounded-md p-0 hover:bg-accent">
                <Plus className="h-3.5 w-3.5" />
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="p-0">
                <Suspense
                  fallback={
                    <div className="flex h-[400px] w-[350px] items-center justify-center">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  }
                >
                  <EmojiPicker
                    onEmojiClick={handleEmojiClick}
                    theme={"auto" as import("emoji-picker-react").Theme}
                    lazyLoadEmojis={true}
                    width={350}
                    height={400}
                    searchPlaceholder="Search emoji..."
                  />
                </Suspense>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </div>
          <ContextMenuSeparator />

          {userIsAuthor && (
            <>
              <ContextMenuItem onClick={handleEdit}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </ContextMenuItem>
              <ContextMenuItem onClick={handleDelete}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </ContextMenuItem>
            </>
          )}
          {!message.deleted && (
            <ContextMenuItem onClick={handleReply}>
              <CornerUpLeft className="mr-2 h-4 w-4" />
              Reply
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={!!lightboxUrl} onOpenChange={() => setLightboxUrl(null)}>
        <DialogPortal>
          <DialogOverlay className="cursor-zoom-out" onClick={() => setLightboxUrl(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
            <img
              src={lightboxUrl!}
              alt=""
              className="max-w-[90vw] max-h-[90vh] object-contain pointer-events-auto"
            />
          </div>
          <button
            type="button"
            autoFocus
            onClick={() => setLightboxUrl(null)}
            className="fixed right-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white ring-1 ring-white/20 hover:bg-black/80 hover:ring-white/40 transition-all focus:outline-none focus:ring-2 focus:ring-white/50"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </DialogPortal>
      </Dialog>
    </>
  );
}
