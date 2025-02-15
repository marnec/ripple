"use client";
import { Message } from "@/components/Chat/Message";
import { MessageList } from "@/components/Chat/MessageList";
import { useQueryWithStatus } from "@/main";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { LoadingSpinner } from "../ui/loading-spinner";
import { toast } from "../ui/use-toast";
import "./chat-composer.css";
import { MessageComposer } from "./MessageComposer";

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

  const sendMessage = useMutation(api.messages.send);

  const handleSubmit = (content: string) => {
    sendMessage({ body: content, channelId }).catch((error) => {
      toast({ variant: "destructive", title: "could not send message", content: error });
    });
  };

  return (
    <>
      <MessageList messages={messages} >
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
      <div className="border-t">
        <MessageComposer handleSubmit={handleSubmit}></MessageComposer>
      </div>
    </>
  );
}
