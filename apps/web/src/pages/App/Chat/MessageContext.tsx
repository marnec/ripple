import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Message } from "./Message";
import { Button } from "../../../components/ui/button";
import { ArrowLeftIcon, XIcon } from "lucide-react";
import { ScrollArea } from "../../../components/ui/scroll-area";
import { ReactionsContext } from "./ReactionsContext";

interface MessageContextProps {
  messageId: Id<"messages">;
  channelId: Id<"channels">;
  onClose: () => void;
  onBackToChat: () => void;
}

export function MessageContext({ messageId, channelId: _channelId, onClose, onBackToChat }: MessageContextProps) {
  const contextData = useQuery(api.messages.getMessageContext, { messageId });

  const messages = contextData?.messages;
  const targetIndex = contextData?.targetIndex;

  const contextMessageIds = (messages ?? []).map((m) => m._id);
  const reactionsMap = useQuery(
    api.messageReactions.listForMessages,
    contextMessageIds.length > 0 ? { messageIds: contextMessageIds } : "skip",
  );

  if (!contextData) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-current"></div>
      </div>
    );
  }

  return (
    <ReactionsContext.Provider value={reactionsMap ?? {}}>
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between p-4 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBackToChat}
            className="flex items-center gap-2"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back to Chat
          </Button>
        </div>
        <div className="text-sm text-muted-foreground">
          Message Context
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <XIcon className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages */}
      <ScrollArea className="min-h-0 flex-1 overflow-hidden">
        <div className="space-y-4 p-4">
          {messages!.map((message, index) => (
            <div key={message.isomorphicId}>
              {/* Highlight the target message */}
              <div
                className={
                  index === targetIndex
                    ? "ring-2 ring-primary ring-offset-2 ring-offset-background rounded-lg"
                    : ""
                }
              >
                <Message message={message} />
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
    </ReactionsContext.Provider>
  );
}