import { ReactNode, useEffect, useRef } from "react";
import { ScrollArea } from "../ui/scroll-area";
import { useResizeObserver } from "usehooks-ts";

export function MessageList({ children }: { messages: unknown; children: ReactNode }) {
  const messageListRef = useRef<HTMLOListElement>(null);
  const { height = 0 } = useResizeObserver({ ref: messageListRef, box: "border-box" });

  useEffect(() => {
    if (!messageListRef?.current) return;

    messageListRef?.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
      inline: "end",
    });
  }, [height]);

  return (
    <ScrollArea className="h-full">
      <ol ref={messageListRef} className="flex grow flex-col-reverse gap-4 px-8 py-4">
        {children}
      </ol>
    </ScrollArea>
  );
}
