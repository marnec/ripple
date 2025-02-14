import { ReactNode, useEffect, useRef } from "react";
import { ScrollArea } from "../ui/scroll-area";

export function MessageList({ messages, children }: { messages: unknown; children: ReactNode }) {
  const messageListRef = useRef<HTMLOListElement>(null);
  const lastMessageRef = useRef<HTMLLIElement | undefined>((children as HTMLLIElement[]).at(-1));

  // Scrolls the list down when new messages
  // are received or sent.
  useEffect(() => {
    if (lastMessageRef?.current) {
      lastMessageRef.current.scrollIntoView({ behavior: "smooth" });
    }
    // if (messageListRef.current) {

    //   messageListRef.current.scrollTo({
    //     top: messageListRef.current.scrollHeight,
    //     behavior: "smooth",
    //   });
    // }
  }, [messages]);

  return (
    <ScrollArea className="h-full">
      <ol ref={messageListRef} className="flex grow flex-col-reverse gap-4 px-8 py-4">
        {children}
      </ol>
    </ScrollArea>
  );
}
