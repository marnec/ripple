"use client";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";
import { Button } from "@/components/ui/button";
import { useMutation, useQuery } from "convex/react";
import { FormEvent, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { MessageList } from "@/components/Chat/MessageList";
import { Message } from "@/components/Chat/Message";
import { Id } from "../../../convex/_generated/dataModel";
import { Schema } from "@shared/enums/schema";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";

export type ChatProps = {
  viewer: Id<typeof Schema.users>;
  channelId: Id<typeof Schema.channels>;
};

export function Chat({ viewer, channelId }: ChatProps) {
  const [newMessageText, setNewMessageText] = useState("");
  const messages = useQuery(api.messages.list, { channelId });
  const sendMessage = useMutation(api.messages.send);
  const editor = useCreateBlockNote();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNewMessageText("");
    sendMessage({ body: newMessageText, channelId }).catch((error) => {
      console.error("Failed to send message:", error);
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
          >
            {message.body}
          </Message>
        ))}
      </MessageList>
      <div className="border-t">
        <form onSubmit={handleSubmit} className="container flex gap-2 py-4">
          <BlockNoteView editor={editor} />
          {/* <Input
            value={newMessageText}
            onChange={(event) => setNewMessageText(event.target.value)}
            placeholder="Write a message…"
          /> */}
          <Button type="submit" disabled={newMessageText === ""}>
            Send
          </Button>
        </form>
      </div>
    </>
  );
}
