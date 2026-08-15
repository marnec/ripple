import type { MessageWithAuthor } from "@convex/types/channel";
import { ArrowDown } from "lucide-react";
import type React from "react";
import { type PropsWithChildren, useEffect, useLayoutEffect, useRef, useState } from "react"
import { ScrollArea } from "../../../components/ui/scroll-area";

const NEAR_BOTTOM_THRESHOLD = 100;

type MessageListProps = PropsWithChildren & {
  messages: MessageWithAuthor[];
  onLoadMore: () => void;
  isLoading: boolean;
  userSentMessageRef?: React.RefObject<boolean>;
  messagesReady: boolean;
};

export function MessageList({ children, messages, userSentMessageRef, messagesReady }: MessageListProps) {
  const messageListRef = useRef<HTMLOListElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const previousLastMessage = useRef<MessageWithAuthor | null>(null);
  const previousMessagesLength = useRef(0);

  // Scroll tracking refs
  const isNearBottomRef = useRef(true);
  const lastScrollTop = useRef(0);
  const lastScrollHeight = useRef(0);
  const initialScrollDone = useRef(false);

  // Scroll-to-bottom button visibility + unread indicator
  const [showScrollButton, setShowScrollButton] = useState(false);
  const hasNewMessagesRef = useRef(false);
  const [hasNewMessages, setHasNewMessages] = useState(false);

  const getViewport = () =>
    scrollAreaRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');

  // Attach scroll listener to the viewport
  useEffect(() => {
    const viewport = getViewport();
    const content = messageListRef.current;
    if (!viewport || !content) return;

    const syncScrollState = () => {
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

    // The list keeps growing after the initial scroll-to-bottom — images
    // decoding are the usual cause. Growth does not move `scrollTop`, so the
    // browser fires no scroll event: without this observer the view is left
    // stranded mid-list while `isNearBottomRef` still says "at bottom", which
    // is why the scroll-to-bottom button only appeared after a manual nudge.
    // While the user is pinned to the bottom, re-pin; either way re-derive the
    // button state from the new geometry.
    const observer = new ResizeObserver(() => {
      if (!initialScrollDone.current) return;
      if (isNearBottomRef.current) {
        viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight;
      }
      syncScrollState();
    });
    observer.observe(content);
    observer.observe(viewport);

    syncScrollState();
    viewport.addEventListener("scroll", syncScrollState, { passive: true });
    return () => {
      viewport.removeEventListener("scroll", syncScrollState);
      observer.disconnect();
    };
  }, []);

  // Initial scroll to bottom — fires once when children are actually in the DOM.
  // messagesReady becomes true only after reactions loaded + messages exist,
  // meaning children have been committed to the DOM in this same render.
  useLayoutEffect(() => {
    if (!messagesReady || initialScrollDone.current) return;
    const viewport = getViewport();
    if (!viewport) return;
    // scrollHeight - clientHeight = maximum scrollTop = physical bottom = newest messages.
    viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight;
    initialScrollDone.current = true;
    previousLastMessage.current = messages[0];
    previousMessagesLength.current = messages.length;
  }, [messagesReady, messages]);

  // Ongoing scroll management: new messages + load-more position compensation.
  useLayoutEffect(() => {
    if (!messageListRef?.current || !initialScrollDone.current) return;

    if (previousLastMessage.current?.isomorphicId !== messages?.[0]?.isomorphicId) {
      // New message at the bottom
      if (userSentMessageRef?.current || isNearBottomRef.current) {
        const viewport = getViewport();
        viewport?.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
      } else {
        // User is scrolled up — show notification dot
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
  }, [messages, userSentMessageRef]);

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
      className="relative h-full **:data-[slot=scroll-area-viewport]:h-full **:data-[slot=scroll-area-viewport]:overscroll-contain *:data-[slot=scroll-area-scrollbar]:hidden *:data-[slot=scroll-area-scrollbar]:sm:flex"
      ref={scrollAreaRef}
    >
      <ol ref={messageListRef} className="flex grow flex-col-reverse px-1 py-4 sm:px-4">
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
