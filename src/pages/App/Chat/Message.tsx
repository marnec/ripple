import { UserContext } from "@/pages/App/UserContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { MessageWithAuthor } from "@shared/types/channel";
import { useMutation } from "convex/react";
import { CornerUpLeft, Loader2, Pencil, Plus, Trash2, X as XIcon } from "lucide-react";
import React, { Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
import { Dialog, DialogClose, DialogOverlay, DialogPortal } from "../../../components/ui/dialog";
import { useChatContext } from "./ChatContext";
import { MentionedUsersContext, MentionedTasksContext, MentionedProjectsContext, MentionedResourcesContext } from "./MentionedUsersContext";
import { MessageReactions } from "./MessageReactions";
import { MessageRenderer } from "./MessageRenderer";
import { hasImageBlocks } from "./messageUtils";
import type { GroupPosition, MessageGroupInfo } from "./messageGrouping";
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

const BUBBLE_RADIUS: Record<"own" | "other", Record<GroupPosition, string>> = {
  own: {
    solo:   "rounded-2xl rounded-br-sm",
    first:  "rounded-2xl rounded-br-sm",
    middle: "rounded-2xl rounded-tr-sm rounded-br-sm",
    last:   "rounded-2xl rounded-tr-sm",
  },
  other: {
    solo:   "rounded-2xl rounded-bl-sm",
    first:  "rounded-2xl rounded-bl-sm",
    middle: "rounded-2xl rounded-tl-sm rounded-bl-sm",
    last:   "rounded-2xl rounded-tl-sm",
  },
};

const DEFAULT_GROUP_INFO: MessageGroupInfo = {
  position: "solo",
  showAuthor: true,
  showTimestamp: true, // unused in Message but part of MessageGroupInfo
};

type MessageProps = {
  message: MessageWithAuthor;
  groupInfo?: MessageGroupInfo;
};

export function Message({ message, groupInfo = DEFAULT_GROUP_INFO }: MessageProps) {
  const { author, body, userId, _creationTime } = message;
  const user = useContext(UserContext);

  const isMobile = useIsMobile();
  const userIsAuthor = userId === user?._id;
  const { position, showAuthor } = groupInfo;
  // On desktop all messages are left-aligned → use "other" (left-side) radius for all
  // On mobile own messages are right-aligned → use "own" (right-side) radius
  const radiusSide = (userIsAuthor && isMobile) ? "own" : "other";
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

  const handleImageClick = useCallback((_thumbnailUrl: string, fullUrl: string) => {
    setLightboxUrl(fullUrl);
  }, []);

  const formattedTime = new Date(_creationTime).toLocaleTimeString(undefined, { timeStyle: 'short' });

  return (
    <>
      <ContextMenu>
        <li
          ref={messageRef}
          className={cn(
            "relative flex flex-col text-sm animate-slide-up sm:items-start",
            userIsAuthor ? "items-end" : "items-start",
            position === "solo" || position === "last" ? "mb-2" : "mb-px",
          )}
        >
          <ContextMenuTrigger className={cn("max-w-[85%] sm:max-w-[70%]", userIsAuthor && "ml-auto sm:ml-0")}>
            <MentionedUsersContext.Provider value={message.mentionedUsers ?? {}}>
            <MentionedTasksContext.Provider value={message.mentionedTasks ?? {}}>
            <MentionedProjectsContext.Provider value={message.mentionedProjects ?? {}}>
            <MentionedResourcesContext.Provider value={message.mentionedResources ?? {}}>
              <div
                className={cn(
                  "w-fit transition-all",
                  BUBBLE_RADIUS[radiusSide][position],
                  userIsAuthor
                    ? "bg-message-own text-message-own-foreground ml-auto sm:ml-0"
                    : "bg-muted",
                  messageHasImages ? "overflow-hidden" : "px-3 py-1.5",
                )}
              >
                {showAuthor && (
                  <div className="text-xs font-semibold text-primary mb-0.5">{author}</div>
                )}
                {message.replyToId && (
                  <div className={messageHasImages ? "px-3 pt-1.5" : undefined}>
                    <MessageQuotePreview message={message.replyTo ?? null} compact />
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <MessageRenderer blocks={blocks} onImageClick={handleImageClick} />
                  </div>
                  <span className={cn(
                    "shrink-0 self-end translate-y-0.5 text-[10px] leading-none select-none",
                    userIsAuthor ? "text-message-own-foreground/50" : "text-muted-foreground/60",
                  )}>
                    {formattedTime}
                  </span>
                </div>
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
                    <div className="flex h-100 w-87.5 items-center justify-center">
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

      {lightboxUrl && (
        <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      )}
    </>
  );
}

function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogPortal>
        <DialogOverlay className="cursor-zoom-out" onClick={onClose} />
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <img
            src={url}
            alt=""
            className="max-w-[90vw] max-h-[90vh] object-contain pointer-events-auto"
          />
        </div>
        <DialogClose
          ref={closeRef}
          render={
            <button
              type="button"
              className="fixed right-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white ring-1 ring-white/20 hover:bg-black/80 hover:ring-white/40 transition-all focus:outline-none focus:ring-2 focus:ring-white/50"
            />
          }
        >
          <XIcon className="h-5 w-5" />
        </DialogClose>
      </DialogPortal>
    </Dialog>
  );
}
