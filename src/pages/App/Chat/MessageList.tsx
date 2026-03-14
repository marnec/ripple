import { MessageWithAuthor } from "@shared/types/channel";
import { ArrowDown } from "lucide-react";
import React, { PropsWithChildren, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useResizeObserver } from "usehooks-ts";
import { ScrollArea } from "../../../components/ui/scroll-area";

const NEAR_BOTTOM_THRESHOLD = 100;

type MessageListProps = PropsWithChildren & {
  messages: MessageWithAuthor[];
  onLoadMore: () => void;
  isLoading: boolean;
  userSentMessageRef?: React.RefObject<boolean>;
};

export function MessageList({ children, messages, userSentMessageRef }: MessageListProps) {
  const messageListRef = useRef<HTMLOListElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const { height = 0 } = useResizeObserver({ ref: messageListRef as React.RefObject<HTMLElement>, box: "border-box" });
  const previousLastMessage = useRef<MessageWithAuthor | null>(null);
  const previousMessagesLength = useRef(0);

  // Scroll tracking refs
  const isNearBottomRef = useRef(true);
  const lastScrollTop = useRef(0);
  const lastScrollHeight = useRef(0);

  // Scroll-to-bottom button visibility + unread indicator
  const [showScrollButton, setShowScrollButton] = useState(false);
  const hasNewMessagesRef = useRef(false);
  const [hasNewMessages, setHasNewMessages] = useState(false);

  const getViewport = () =>
    scrollAreaRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');

  // Attach scroll listener to the viewport
  useEffect(() => {
    const viewport = getViewport();
    if (!viewport) return;

    const handleScroll = () => {
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      const nearBottom = distanceFromBottom < NEAR_BOTTOM_THRESHOLD;
      isNearBottomRef.current = nearBottom;
      setShowScrollButton(!nearBottom);
      if (nearBottom) {
        hasNewMessagesRef.current = false;
      }
      setHasNewMessages(hasNewMessagesRef.current);
      lastScrollTop.current = viewport.scrollTop;
      lastScrollHeight.current = viewport.scrollHeight;
    };

    handleScroll();
    viewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", handleScroll);
  }, []);

  useLayoutEffect(() => {
    if (!messageListRef?.current) return;

    if (previousLastMessage.current?.isomorphicId !== messages?.[0]?.isomorphicId) {
      // New message arrived
      const isFirstRender = !previousLastMessage.current;
      if (isFirstRender || userSentMessageRef?.current || isNearBottomRef.current) {
        // Always scroll on first render, user's own message, or when near bottom
        messageListRef.current.scrollIntoView({
          behavior: isFirstRender ? "instant" : "smooth",
          block: "end",
          inline: "end",
        });
      } else {
        // User is scrolled up and received a message — show notification dot
        hasNewMessagesRef.current = true;
      }
    } else {
      // Same newest message — content changed (load-more or resize)
      const viewport = getViewport();
      if (viewport && messages.length > previousMessagesLength.current && previousMessagesLength.current > 0) {
        // Older messages loaded — compensate for height change to preserve scroll position
        const heightDelta = viewport.scrollHeight - lastScrollHeight.current;
        viewport.scrollTop = lastScrollTop.current + heightDelta;
      }
    }

    if (userSentMessageRef?.current) {
      userSentMessageRef.current = false;
    }
    previousLastMessage.current = messages[0];
    previousMessagesLength.current = messages.length;
  }, [height, messages, userSentMessageRef]);

  // Sync hasNewMessages ref to state after layout effect
  useEffect(() => {
    setHasNewMessages(hasNewMessagesRef.current);
  }, [messages]);

  const scrollToBottom = () => {
    const viewport = getViewport();
    if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    }
  };

  return (
    <ScrollArea
      className="relative h-full **:data-[slot=scroll-area-viewport]:h-full **:data-[slot=scroll-area-viewport]:overscroll-contain"
      ref={scrollAreaRef}
    >
      <ol ref={messageListRef} className="flex grow flex-col-reverse gap-4 px-4 py-4">
        {children}
      </ol>
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-primary p-2 text-primary-foreground shadow-lg animate-fade-in cursor-pointer"
          aria-label="Scroll to latest messages"
        >
          {hasNewMessages && (
            <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-destructive" />
          )}
          <ArrowDown className="h-4 w-4" />
        </button>
      )}
    </ScrollArea>
  );
}
