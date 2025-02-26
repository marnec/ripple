import { Children, ReactNode, useLayoutEffect, useRef } from "react";
import { useResizeObserver } from "usehooks-ts";
import { ScrollArea } from "../ui/scroll-area";

export function MessageList({ children }: { children: ReactNode }) {
  const messageListRef = useRef<HTMLOListElement>(null);
  const { height = 0 } = useResizeObserver({ ref: messageListRef, box: "border-box" });
  const prevChildrenCountRef = useRef(0);

  useLayoutEffect(() => {
    if (!messageListRef?.current) return;

    const childrenCount = Children.count(children);

    messageListRef.current.scrollIntoView({
      behavior: "smooth",
      block: "end",
      inline: "end",
    });

    prevChildrenCountRef.current = childrenCount;
  }, [height, children]);

  return (
    <ScrollArea className="h-full">
      <ol ref={messageListRef} className="flex grow flex-col-reverse gap-4 px-8 py-4">
        {children}
      </ol>
    </ScrollArea>
  );
}
