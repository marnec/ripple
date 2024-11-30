"use client";
import { Message } from "@/components/Chat/Message";
import { MessageList } from "@/components/Chat/MessageList";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";
import { Schema } from "@shared/enums/schema";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import "./chat-composer.css";
import { MessageComposer } from "./MessageComposer";
import { toast } from "../ui/use-toast";

export type ChatProps = {
  viewer: Id<typeof Schema.users>;
  channelId: Id<typeof Schema.channels>;
};

export function Chat({ viewer, channelId }: ChatProps) {
  const messages = useQuery(api.messages.list, { channelId });
  const sendMessage = useMutation(api.messages.send);

  const handleSubmit = (content: string) => {

    sendMessage({ body: content, channelId })
      .catch((error) => {
        toast({ variant: 'destructive', title: 'could not send message', content: error })
      });
  };

  return (
    <>
      <MessageList messages={messages}>
        {messages?.map((message) => (
          <Message
            key={message._id}
            author={message.userId}
            authorName={message.author}
            viewer={viewer}
            content={message.body}
          >
          </Message>
        ))}
      </MessageList>
      <div className="border-t">
        <MessageComposer handleSubmit={handleSubmit}></MessageComposer>
      </div>
    </>
  );
}
