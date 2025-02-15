import { ReactNode, useEffect, useRef } from "react";
import { ScrollArea } from "../ui/scroll-area";

export function MessageList({ messages, children }: { messages: unknown; children: ReactNode }) {
  const messageListRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!messageListRef?.current) return;
    
    // Put at the end of call-stack so that children are rendered.
    // Otherwise scroll happens before children are completely rendered and
    // the size of the element is miscalculated. 
    // Probably due to BlockNoteView rendering late.
    setTimeout(() => {
      messageListRef?.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
        inline: "end",
      });
    });
  }, [messages]);

  return (
    <ScrollArea className="h-full">
      <ol ref={messageListRef} className="flex grow flex-col-reverse gap-4 px-8 py-4">
        {children}
      </ol>
    </ScrollArea>
  );
}
