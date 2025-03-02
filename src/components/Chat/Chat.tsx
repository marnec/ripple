"use client";
import { Message } from "@/components/Chat/Message";
import { MessageList } from "@/components/Chat/MessageList";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";
import { useMutation, usePaginatedQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "../ui/button";
import { LoadingSpinner } from "../ui/loading-spinner";
import { toast } from "../ui/use-toast";
import "./message-composer.css";
import { MessageComposer } from "./MessageComposer";
import { MessageWithAuthor } from "@shared/types/channel";
import { Separator } from "../ui/separator";

export type ChatProps = {
  viewer: Id<"users">;
  channelId: Id<"channels">;
};

export function Chat({ viewer, channelId }: ChatProps) {
  const {
    results: messages,
    status,
    isLoading,
    loadMore,
  } = usePaginatedQuery(api.messages.list, { channelId }, { initialNumItems: 25 });

  const sendMessage = useMutation(api.messages.send);

  const handleLoadMore = () => {
    if (!isLoading) {
      loadMore(25);
    }
  };

  const handleSubmit = async (body: string, plainText: string) => {
    const isomorphicId = crypto.randomUUID();

    await sendMessage({ body, plainText, channelId, isomorphicId }).catch((error) => {
      toast({ variant: "destructive", title: "could not send message", content: error });
    });
  };

  const wereSentInDifferentDays = (
    message1: MessageWithAuthor,
    message2: MessageWithAuthor,
  ): boolean => {
    return (
      new Date(message1._creationTime).toDateString() !==
      new Date(message2._creationTime).toDateString()
    );
  };

  return (
    <>
      <MessageList messages={messages} onLoadMore={handleLoadMore} isLoading={isLoading}>
        {!messages && <LoadingSpinner className="h-12 w-12 self-center" />}

        {messages &&
          messages.map((message, index) => (
            <>
              {!!index && wereSentInDifferentDays(message, messages[index - 1]) && (
                <>
                  <Separator orientation="horizontal" className="-mt-7" />
                  <div className="self-center text-muted px-2 z-10 bg-card">
                    {new Date(message._creationTime).toDateString()}
                  </div>
                </>
              )}
              <Message key={message.isomorphicId} message={message}></Message>
            </>
          ))}
        {messages && (
          <Button
            variant="outline"
            className="self-center sm:w-fit w-full"
            disabled={status === "Exhausted"}
            onClick={() => loadMore(25)}
          >
            Load more...
          </Button>
        )}
      </MessageList>

      <MessageComposer handleSubmit={handleSubmit}></MessageComposer>
    </>
  );
}
