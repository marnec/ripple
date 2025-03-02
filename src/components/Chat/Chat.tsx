"use client";
import { Message } from "@/components/Chat/Message";
import { MessageList } from "@/components/Chat/MessageList";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";
import { MessageWithAuthor } from "@shared/types/channel";
import { useMutation, usePaginatedQuery } from "convex/react";
import { createContext, useContext, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "../ui/button";
import { LoadingSpinner } from "../ui/loading-spinner";
import { Separator } from "../ui/separator";
import { toast } from "../ui/use-toast";
import "./message-composer.css";
import { MessageComposer } from "./MessageComposer";

export const useChatContext = () => {
  const context = useContext(ChatContext);
  if (!context) throw new Error("useChatContext must be used within ChatProvider");
  return context;
}


type EditingMessage = { body: Id<"messages"> | null, id: string | null }

type EditingMessageContext = {
  editingMessage: EditingMessage
  setEditingMessage: (msg: EditingMessage) => void
}

export const ChatContext = createContext<EditingMessageContext | null>(null);

export type ChatProps = {
  viewer: Id<"users">;
  channelId: Id<"channels">;
};

export function Chat({ channelId }: ChatProps) {
  const [editingMessage, setEditingMessage] = useState<EditingMessage>({ id: null, body: null })
  const {
    results: messages,
    status,
    isLoading,
    loadMore,
  } = usePaginatedQuery(api.messages.list, { channelId }, { initialNumItems: 25 });

  const sendMessage = useMutation(api.messages.send);
  const editMessage = useMutation(api.messages.update);

  const handleLoadMore = () => {
    if (!isLoading) {
      loadMore(25);
    }
  };

  const handleSubmit = async (body: string, plainText: string) => {
    if (editingMessage.id) {

      await editMessage(editingMessage)

      setEditingMessage({ id: null, body: null })
    } else {

      const isomorphicId = crypto.randomUUID();

      await sendMessage({ body, plainText, channelId, isomorphicId }).catch((error) => {
        toast({ variant: "destructive", title: "could not send message", content: error });
      });
    }

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
    <ChatContext.Provider value={{ editingMessage, setEditingMessage }}>
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
    </ ChatContext.Provider>
  );
}
