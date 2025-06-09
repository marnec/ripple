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
import { SearchDialog } from "./SearchDialog";
import { MessageContext } from "./MessageContext";
import { SearchIcon } from "lucide-react";
import { Input } from "../../../components/ui/input";

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
  const [viewMode, setViewMode] = useState<'chat' | 'context'>('chat');
  const [contextMessageId, setContextMessageId] = useState<Id<"messages"> | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [isSearchDialogOpen, setIsSearchDialogOpen] = useState(false);
  const [searchDialogTerm, setSearchDialogTerm] = useState("");
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

  const handleJumpToMessage = (messageId: Id<"messages">) => {
    setContextMessageId(messageId);
    setViewMode('context');
  };

  const handleBackToChat = () => {
    setViewMode('chat');
    setContextMessageId(null);
  };

  const handleSearchSubmit = () => {
    if (searchInput.trim()) {
      setSearchDialogTerm(searchInput.trim());
      setIsSearchDialogOpen(true);
    }
  };

  const handleSearchKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearchSubmit();
    }
  };

  return (
    <ChatContext.Provider value={{ editingMessage, setEditingMessage }}>
      {/* Show message context view when jumping to a specific message */}
      {viewMode === 'context' && contextMessageId ? (
        <MessageContext
          messageId={contextMessageId}
          onClose={handleBackToChat}
          onBackToChat={handleBackToChat}
        />
      ) : (
        <>
          {/* Main Chat View */}
      {/* Inline Search */}
      <div className="flex items-center gap-2 p-2 border-b">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search messages..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyPress={handleSearchKeyPress}
            className="pl-10 pr-12"
          />
        </div>
        <SearchDialog 
          channelId={channelId} 
          onJumpToMessage={handleJumpToMessage}
          initialSearchTerm={searchDialogTerm}
          isOpen={isSearchDialogOpen}
          onOpenChange={setIsSearchDialogOpen}
        >
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleSearchSubmit}
            disabled={!searchInput.trim()}
          >
            <SearchIcon className="h-4 w-4" />
          </Button>
        </SearchDialog>
      </div>

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
            disabled={status === "Exhausted" || isLoading || !messages?.length}
            onClick={() => loadMore(25)}
          >
            Load more...
          </Button>
        )}
      </MessageList>

          <MessageComposer handleSubmit={handleSubmit}></MessageComposer>
        </>
      )}
    </ChatContext.Provider>
  );
}
