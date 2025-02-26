"use client";
import { Message } from "@/components/Chat/Message";
import { MessageList } from "@/components/Chat/MessageList";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { LoadingSpinner } from "../ui/loading-spinner";
import { toast } from "../ui/use-toast";
import "./message-composer.css";
import { MessageComposer } from "./MessageComposer";
import { useContext } from "react";
import { UserContext } from "@/App";

export type ChatProps = {
  viewer: Id<"users">;
  channelId: Id<"channels">;
};

export function Chat({ viewer, channelId }: ChatProps) {
  const messages = useQuery(api.messages.list, { channelId });
  const currentUser = useContext(UserContext);

  const sendMessage = useMutation(api.messages.send).withOptimisticUpdate(
    (localStore, { channelId, body, isomorphicId, plainText }) => {
      const messages = localStore.getQuery(api.messages.list, { channelId });

      if (messages === undefined) {
        console.warn("Could not run optimistic update since api.messages.list is undefined");
        return;
      }

      localStore.setQuery(api.messages.list, { channelId }, [
        {
          _id: `optimistic-${isomorphicId}` as Id<"messages">,
          _creationTime: +new Date(),
          isomorphicId,
          plainText,
          author: currentUser?.name ?? currentUser?.email ?? "...",
          body,
          channelId,
          userId: viewer,
        },
        ...messages,
      ]);
    },
  );

  const handleSubmit = (body: string, plainText: string) => {
    const isomorphicId = crypto.randomUUID();

    sendMessage({ body, plainText, channelId, isomorphicId }).catch((error) => {
      toast({ variant: "destructive", title: "could not send message", content: error });
    });
  };

  return (
    <>
      <MessageList>
        {!messages && <LoadingSpinner className="h-12 w-12 self-center" />}
        {messages &&
          messages.map((message) => (
            <Message
              key={message.isomorphicId}
              author={message.userId}
              authorName={message.author}
              viewer={viewer}
              content={message.body}
            ></Message>
          ))}
      </MessageList>

      <MessageComposer handleSubmit={handleSubmit}></MessageComposer>
    </>
  );
}
