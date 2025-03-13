"use client";
import { Message } from "@/pages/App/Chat/Message";
import { MessageList } from "@/pages/App/Chat/MessageList";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";
import { MessageWithAuthor } from "@shared/types/channel";
import { useMutation, usePaginatedQuery } from "convex/react";
import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Button } from "../../../components/ui/button";
import { toast } from "../../../components/ui/use-toast";
import "./message-composer.css";
import { MessageComposer } from "./MessageComposer";
import { Separator } from "../../../components/ui/separator";
import { ConvexError } from "convex/values";

export const useChatContext = () => {
  const context = useContext(ChatContext);
  if (!context) throw new ConvexError("useChatContext must be used within ChatProvider");
  return context;
};

type EditingMessage = { body: string | null; id: Id<"messages"> | null };

type EditingMessageContext = {
  editingMessage: EditingMessage;
  setEditingMessage: (msg: EditingMessage) => void;
};

export const ChatContext = createContext<EditingMessageContext | null>(null);

export type ChatProps = {
  channelId: Id<"channels">;
};

export function Chat({ channelId }: ChatProps) {
  const [editingMessage, setEditingMessage] = useState<EditingMessage>({ id: null, body: null });
  const {
    results: messages,
    status,
    isLoading,
    loadMore,
  } = usePaginatedQuery(api.messages.list, { channelId }, { initialNumItems: 25 });

  const sendMessage = useMutation(api.messages.send);
  const editMessage = useMutation(api.messages.update);

  useEffect(() => {
    console.log(messages);
  }, [messages]);

  const handleLoadMore = () => {
    if (!isLoading) {
      loadMore(25);
    }
  };

  const handleSubmit = async (body: string, plainText: string) => {
    if (editingMessage.id) {
      await editMessage({ id: editingMessage.id, body, plainText }).finally(() => {
        setEditingMessage({ id: null, body: null });
      });
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
        {/* {!messages && <LoadingSpinner className="h-12 w-12 self-center" />} */}

        {(messages || []).map((message, index) => (
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
    </ChatContext.Provider>
  );
}
