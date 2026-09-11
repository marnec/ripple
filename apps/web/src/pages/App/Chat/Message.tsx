import { UserContext } from "@/pages/App/UserContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import type { MessageWithAuthor } from "@convex/types/channel";
import { useMutation } from "convex/react";
import { CornerUpLeft, Loader2, Pencil, Plus, Trash2, X as XIcon } from "lucide-react";
import React, { Suspense, useContext, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
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
import { Dialog, DialogClose, DialogOverlay, DialogPortal } from "@ripple/ui/components/dialog";
import { useChatContext } from "./ChatContext";
import { MentionedUsersContext, MentionedTasksContext, MentionedProjectsContext, MentionedResourcesContext, MentionedEventsContext } from "./MentionedUsersContext";
import { MessageReactions } from "./MessageReactions";
import { MessageRenderer } from "./MessageRenderer";
import { hasImageBlocks } from "./messageUtils";
import type { GroupPosition, MessageGroupInfo } from "./messageGrouping";
import { MessageQuotePreview } from "./MessageQuotePreview";
import { Avatar, AvatarFallback, AvatarImage } from "@ripple/ui/components/avatar";
import { AssistantAvatar } from "@/components/AssistantAvatar";
import { isMessageEditable } from "@shared/constants";

const EmojiPicker = React.lazy(() => import("emoji-picker-react"));

/**
 * Marks a message the workspace assistant wrote. The author line already
 * carries its name; this says the name is a model, not a colleague, which is
 * the one thing a reader cannot tell from the bubble.
 */
function AssistantBadge() {
  return (
    <span className="rounded-sm bg-foreground/10 px-1 py-px text-[10px] font-medium uppercase tracking-wide text-foreground/70">
      AI
    </span>
  );
}

const QUICK_EMOJIS = [
  { unified: "2764-fe0f", native: "\u2764\uFE0F" },
  { unified: "1f44d", native: "\uD83D\uDC4D" },
  { unified: "1f602", native: "\uD83D\uDE02" },
  { unified: "1f525", native: "\uD83D\uDD25" },
  { unified: "1f622", native: "\uD83D\uDE22" },
  { unified: "1f389", native: "\uD83C\uDF89" },
];

/**
 * Which edge of the row a bubble sits against. Two layouts share the file:
 *
 * - Desktop: people's messages, the viewer's included, all sit on the left,
 *   and the workspace assistant takes the right — the far side of the
 *   conversation, so an exchange with it reads as one.
 * - Mobile: the viewer's own messages take the right, everyone else — the
 *   assistant included — the left, the shape every phone messenger has.
 *
 * The bubble's radius and tail follow the edge, not the author, which is why
 * they are keyed on this rather than on "own".
 */
type BubbleSide = "start" | "end";

const BUBBLE_RADIUS: Record<BubbleSide, Record<GroupPosition, string>> = {
  end: {
    solo:   "rounded-lg rounded-br-sm",
    first:  "rounded-lg rounded-br-sm",
    middle: "rounded-r-sm rounded-l-lg",
    last:   "rounded-lg rounded-tr-sm",
  },
  start: {
    solo:   "rounded-lg rounded-bl-sm",
    first:  "rounded-lg rounded-bl-sm",
    middle: "rounded-l-sm rounded-r-lg",
    last:   "rounded-lg rounded-tl-sm",
  },
};

/**
 * The row's direction and the avatar's gutter, per author kind, as responsive
 * classes so a resize re-flows without a re-render: `sm:` is the desktop
 * layout described on `BubbleSide`.
 */
const ROW_LAYOUT = {
  own: {
    row: "flex-row-reverse sm:flex-row",
    gutter: "ml-1.5 sm:ml-0 sm:mr-1.5",
    push: "ml-auto sm:ml-0",
  },
  assistant: {
    row: "flex-row sm:flex-row-reverse",
    gutter: "mr-1.5 sm:mr-0 sm:ml-1.5",
    push: "sm:ml-auto",
  },
  other: {
    row: "flex-row",
    gutter: "mr-1.5",
    push: "",
  },
} as const;

const DEFAULT_GROUP_INFO: MessageGroupInfo = {
  position: "solo",
  showAuthor: true,
};

const MESSAGE_STAGGER_DELAY = 5;
const MESSAGE_STAGGER_CAP = 30;

type MessageProps = {
  message: MessageWithAuthor;
  groupInfo?: MessageGroupInfo;
  index?: number;
};

export function Message({ message, groupInfo = DEFAULT_GROUP_INFO, index = 0 }: MessageProps) {
  const { author, body, userId, _creationTime } = message;
  const user = useContext(UserContext);

  const isMobile = useIsMobile();
  const userIsAuthor = userId === user?._id;
  const isAssistant = !!message.authorIsBot && !userIsAuthor;
  const { position, showAuthor } = groupInfo;
  const layout = ROW_LAYOUT[userIsAuthor ? "own" : isAssistant ? "assistant" : "other"];
  // Which edge the bubble sits against — see `BubbleSide`. Needs the JS
  // breakpoint because the radius classes are not responsive.
  const side: BubbleSide = isMobile
    ? (userIsAuthor ? "end" : "start")
    : (isAssistant ? "end" : "start");
  const messageRef = useRef<HTMLLIElement>(null);

  const { setEditingMessage, setReplyingTo } = useChatContext()
  const deleteMessage = useMutation(api.messages.remove)
  const toggleReaction = useMutation(api.messageReactions.toggle);

  const handleReply = () => {
    // Clear edit mode (mutually exclusive)
    setEditingMessage({ id: null, body: null });
    // Extract image URL if the message contains an image
    let imageUrl: string | undefined;
    try {
      const parsedBlocks: { type: string; props?: { url?: string } }[] = JSON.parse(message.body);
      imageUrl = parsedBlocks.find((b) => b.type === "image")?.props?.url;
    } catch {
      // non-JSON body
    }
    // Enter reply mode
    setReplyingTo({
      id: message._id,
      author: message.author,
      plainText: message.plainText,
      body: message.body,
      ...(imageUrl ? { imageUrl } : {}),
    });
  };

  const handleEdit = () => {
    setReplyingTo(null); // Clear reply mode (mutually exclusive)
    setEditingMessage({ id: message._id, body: message.body });
  };

  const handleDelete = () => void deleteMessage({ id: message._id });

  const handleQuickReaction = (unified: string, native: string) => {
    void toggleReaction({ messageId: message._id, emoji: unified, emojiNative: native });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  };

  const handleEmojiClick = (emojiData: { unified: string; emoji: string }) => {
    void toggleReaction({ messageId: message._id, emoji: emojiData.unified, emojiNative: emojiData.emoji });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  };

  const reactions = message.reactions;
  const hasReactions = reactions.length > 0;

  const blocks = JSON.parse(body);
  const messageHasImages = hasImageBlocks(blocks);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const handleImageClick = (_thumbnailUrl: string, fullUrl: string) => {
    setLightboxUrl(fullUrl);
  };

  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const handleDiagramOpen = (diagramId: string) => {
    if (!workspaceId) return;
    void navigate(`/workspaces/${workspaceId}/diagrams/${diagramId}`);
  };

  const formattedTime = new Date(_creationTime).toLocaleTimeString(undefined, { timeStyle: 'short' });

  const initials = author
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // Avatar visible on the last message of a group (visual bottom) or solo
  const showAvatar = position === "last" || position === "solo";
  // For own messages, use the viewer's profile image
  const avatarImage = userIsAuthor ? user?.image : message.authorImage;
  const avatarName = userIsAuthor ? (user?.name ?? user?.email ?? "You") : author;
  const avatarInitials = userIsAuthor
    ? (user?.name ?? user?.email ?? "Y").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : initials;

  return (
    <>
      <ContextMenu>
        <li
          ref={messageRef}
          className={cn(
            "relative flex flex-col text-sm animate-fade-in",
            position === "solo" || position === "last" ? "mb-2" : "mb-px",
          )}
          style={{
            animationDelay: `${Math.min(index, MESSAGE_STAGGER_CAP) * MESSAGE_STAGGER_DELAY}ms`,
            animationFillMode: "backwards",
          }}
        >
          {/* Message row: avatar + bubble */}
          <div className={cn("flex items-end", layout.row)}>
            {/* Avatar column */}
            <div className={cn("w-9.5 shrink-0", layout.gutter)}>
              {!showAvatar ? (
                <div className="size-8" />
              ) : isAssistant ? (
                <AssistantAvatar name={author} className="size-8" />
              ) : (
                <Avatar className="size-8">
                  <AvatarImage src={avatarImage} alt={avatarName} />
                  <AvatarFallback className="text-xs">{avatarInitials}</AvatarFallback>
                </Avatar>
              )}
            </div>

            {/* Bubble */}
            <ContextMenuTrigger className={cn(
              "min-w-0 max-w-[85%] sm:max-w-[70%]",
              layout.push,
            )}>
              <MentionedUsersContext.Provider value={message.mentionedUsers ?? {}}>
              <MentionedTasksContext.Provider value={message.mentionedTasks ?? {}}>
              <MentionedProjectsContext.Provider value={message.mentionedProjects ?? {}}>
              <MentionedResourcesContext.Provider value={message.mentionedResources ?? {}}>
              <MentionedEventsContext.Provider value={message.mentionedEvents ?? {}}>
                <div
                  className={cn(
                    // `max-w-full` is load-bearing: the quote preview's
                    // `truncate` line is nowrap, which makes the fit-content
                    // bubble's minimum width the whole line, wider than the
                    // column on a phone. Clamping the bubble gives the
                    // ellipsis a width to work with.
                    "w-fit max-w-full transition-all",
                    BUBBLE_RADIUS[side][position],
                    userIsAuthor
                      ? "bg-message-own text-message-own-foreground"
                      : "bg-muted",
                    layout.push,
                    !messageHasImages && (hasReactions ? "px-3 pt-1.5" : "px-3 py-1.5"),
                    showAvatar && (side === "end" ? "bubble-tail-right" : "bubble-tail-left"),
                  )}
                >
                  {showAuthor && (
                    <div className={cn("text-xs font-semibold text-primary mb-0.5 flex items-center gap-1.5", messageHasImages && "px-3 pt-1.5")}>
                      {author}
                      {message.authorIsBot && <AssistantBadge />}
                    </div>
                  )}
                  {message.replyToId && (
                    <div className={messageHasImages ? "px-3 pt-1.5" : undefined}>
                      <MessageQuotePreview message={message.replyTo ?? null} />
                    </div>
                  )}
                  {messageHasImages ? (
                    <>
                      <div className="overflow-hidden rounded-t-[inherit]">
                        <MessageRenderer blocks={blocks} onImageClick={handleImageClick} onDiagramOpen={handleDiagramOpen} />
                      </div>
                      <div className="flex items-end gap-3 px-2 py-1">
                        <MessageReactions messageId={message._id} reactions={reactions} />
                        <span className={cn("ml-auto shrink-0 text-[10px] leading-none select-none", userIsAuthor ? "text-message-own-foreground/50" : "text-muted-foreground/60")}>{formattedTime}</span>
                      </div>
                    </>
                  ) : hasReactions ? (
                    <>
                      <MessageRenderer blocks={blocks} onImageClick={handleImageClick} onDiagramOpen={handleDiagramOpen} />
                      <div className="flex items-end gap-3 pt-1 pb-1.5">
                        <MessageReactions messageId={message._id} reactions={reactions} />
                        <span className={cn("ml-auto shrink-0 text-[10px] leading-none select-none", userIsAuthor ? "text-message-own-foreground/50" : "text-muted-foreground/60")}>{formattedTime}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-end gap-2">
                      <div className="min-w-0 flex-1">
                        <MessageRenderer blocks={blocks} onImageClick={handleImageClick} onDiagramOpen={handleDiagramOpen} />
                      </div>
                      <span className={cn("shrink-0 self-end translate-y-0.5 text-[10px] leading-none select-none", userIsAuthor ? "text-message-own-foreground/50" : "text-muted-foreground/60")}>{formattedTime}</span>
                    </div>
                  )}
                </div>
              </MentionedEventsContext.Provider>
              </MentionedResourcesContext.Provider>
              </MentionedProjectsContext.Provider>
              </MentionedTasksContext.Provider>
              </MentionedUsersContext.Provider>
            </ContextMenuTrigger>
          </div>
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
              {isMessageEditable(_creationTime) && (
                <ContextMenuItem onClick={handleEdit}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </ContextMenuItem>
              )}
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
