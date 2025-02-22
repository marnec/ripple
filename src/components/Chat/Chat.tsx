"use client";
import { Message } from "@/components/Chat/Message";
import { MessageList } from "@/components/Chat/MessageList";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";
import { useAction, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { LoadingSpinner } from "../ui/loading-spinner";
import { toast } from "../ui/use-toast";
import "./message-composer.css";
import { MessageComposer } from "./MessageComposer";
import { useQueryWithStatus } from "../AppSidebar";

export type ChatProps = {
  viewer: Id<"users">;
  channelId: Id<"channels">;
};

export function Chat({ viewer, channelId }: ChatProps) {
  const {
    data: messages,
    isPending,
    isSuccess,
  } = useQueryWithStatus(api.messages.list, { channelId });

  const sendMessage = useAction(api.messages.sendMessage);

  const handleSubmit = (content: string, plainText: string) => {
    sendMessage({ body: content, plainText, channelId }).catch((error) => {
      toast({ variant: "destructive", title: "could not send message", content: error });
    });
  };

  return (
    <>
      <MessageList messages={messages}>
        {isPending && <LoadingSpinner className="h-12 w-12 self-center" />}
        {isSuccess &&
          messages?.map((message) => (
            <Message
              key={message._id}
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
