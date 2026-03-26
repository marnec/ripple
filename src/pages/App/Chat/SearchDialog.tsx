import { useState } from "react";
import { useQuery } from "convex-helpers/react/cache";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "../../../components/ui/responsive-dialog";
import { Input } from "../../../components/ui/input";
import { ScrollArea } from "../../../components/ui/scroll-area";
import { SearchIcon, MessageSquareIcon } from "lucide-react";
import { SafeHtml } from "@/components/ui/safe-html";

interface SearchDialogProps {
  channelId: Id<"channels">;
  onJumpToMessage: (messageId: Id<"messages">) => void;
  children: React.ReactNode;
  initialSearchTerm?: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function SearchContent({
  searchTerm,
  setSearchTerm,
  searchResults,
  onJumpToMessage,
}: {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  searchResults: Array<{ _id: Id<"messages">; _creationTime: number; author: string; plainText: string }> | undefined;
  onJumpToMessage: (messageId: Id<"messages">) => void;
}) {
  const highlightSearchTerm = (text: string, term: string) => {
    if (!term) return text;
    const regex = new RegExp(`(${escapeRegExp(term)})`, 'gi');
    return text.replace(regex, '<mark class="bg-accent text-accent-foreground">$1</mark>');
  };

  return (
    <div className="flex flex-col gap-4 overflow-hidden">
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search messages..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      <ScrollArea className="h-[50vh] sm:h-96">
        {!searchTerm.trim() && (
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            <div className="text-center">
              <MessageSquareIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Type to search messages...</p>
            </div>
          </div>
        )}

        {searchTerm.trim() && !searchResults && (
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-current"></div>
          </div>
        )}

        {searchResults && searchResults.length === 0 && (
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            <div className="text-center">
              <MessageSquareIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No messages found</p>
            </div>
          </div>
        )}

        {searchResults && searchResults.length > 0 && (
          <div className="space-y-2">
            {searchResults.map((message) => (
              <div
                key={message._id}
                className="p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                onClick={() => onJumpToMessage(message._id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e: React.KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onJumpToMessage(message._id);
                  }
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm truncate">{message.author}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(message._creationTime).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-sm">
                    <SafeHtml
                      html={highlightSearchTerm(message.plainText, searchTerm.trim())}
                      className="line-clamp-3"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function SearchDialogBody({
  searchTerm,
  setSearchTerm,
  searchResults,
  onJumpToMessage,
}: {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  searchResults: Array<{ _id: Id<"messages">; _creationTime: number; author: string; plainText: string }> | undefined;
  onJumpToMessage: (messageId: Id<"messages">) => void;
}) {
  return (
    <ResponsiveDialogBody>
      <SearchContent
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        searchResults={searchResults}
        onJumpToMessage={onJumpToMessage}
      />
    </ResponsiveDialogBody>
  );
}

export function SearchDialog({ channelId, onJumpToMessage, children, initialSearchTerm = "", isOpen, onOpenChange }: SearchDialogProps) {
  const [searchTerm, setSearchTerm] = useState(initialSearchTerm);
  const [prevInitialSearchTerm, setPrevInitialSearchTerm] = useState(initialSearchTerm);
  if (initialSearchTerm !== prevInitialSearchTerm) {
    setPrevInitialSearchTerm(initialSearchTerm);
    setSearchTerm(initialSearchTerm);
  }

  const searchResults = useQuery(
    api.messages.search,
    searchTerm.trim() ? { channelId, searchTerm: searchTerm.trim() } : "skip"
  );

  const handleJumpToMessage = (messageId: Id<"messages">) => {
    onJumpToMessage(messageId);
    onOpenChange(false);
    setSearchTerm("");
  };

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={onOpenChange} direction="top">
      <ResponsiveDialogTrigger render={children as React.ReactElement} />
      <ResponsiveDialogContent className="max-w-2xl max-h-[80vh]">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <SearchIcon className="h-4 w-4" />
            Search Messages
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <SearchDialogBody
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          searchResults={searchResults}
          onJumpToMessage={handleJumpToMessage}
        />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
