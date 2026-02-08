import { MessageWithAuthor } from "@shared/types/channel";
import React, { PropsWithChildren, useLayoutEffect, useRef } from "react";
import { useResizeObserver } from "usehooks-ts";
import { ScrollArea } from "../../../components/ui/scroll-area";

type MessageListProps = PropsWithChildren & {
  messages: MessageWithAuthor[];
  onLoadMore: () => void;
  isLoading: boolean;
};

export function MessageList({ children, messages }: MessageListProps) {
  const messageListRef = useRef<HTMLOListElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const { height = 0 } = useResizeObserver({ ref: messageListRef as React.RefObject<HTMLElement>, box: "border-box" });
  const previousLastMessage = useRef<MessageWithAuthor | null>(null);
  const initialRenderRef = useRef(true);

  useLayoutEffect(() => {
    if (!messageListRef?.current) return;

    if (previousLastMessage.current?.isomorphicId !== messages?.[0]?.isomorphicId) {
      messageListRef.current.scrollIntoView({
        behavior: !previousLastMessage.current ? "instant" : "smooth",
        block: "end",
        inline: "end",
      });
    } else {
      if (scrollAreaRef.current?.children?.[1]) {
        scrollAreaRef.current.scrollTop = scrollAreaRef.current?.children[1].scrollHeight; // find a way to maintain scroll position
      }
    }

    // After first render, mark that initial render is complete
    if (initialRenderRef.current) {
      initialRenderRef.current = false;
    }

    previousLastMessage.current = messages[0];
  }, [height, messages]);

  return (
    <ScrollArea
      className="relative h-full overflow-y-auto overscroll-y-contain"
      viewportClassName="h-full overflow-y-auto overscroll-contain"
      ref={scrollAreaRef}
    >
      <ol ref={messageListRef} className="flex grow flex-col-reverse gap-4 px-4 py-4">
        {children}
      </ol>
    </ScrollArea>
  );
}
