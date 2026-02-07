import { useMutation } from "convex/react";
import { Loader2, SmilePlus } from "lucide-react";
import React, { Suspense, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Button } from "../../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";

// Lazy load emoji picker for code splitting
const EmojiPicker = React.lazy(() => import("emoji-picker-react"));

type EmojiClickData = {
  unified: string;
  emoji: string;
};

type Props = {
  messageId: Id<"messages">;
};

export function MessageReactionPicker({ messageId }: Props) {
  const [open, setOpen] = useState(false);
  const toggleReaction = useMutation(api.messageReactions.toggle);

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    void toggleReaction({
      messageId,
      emoji: emojiData.unified,
      emojiNative: emojiData.emoji,
    });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 px-2">
          <SmilePlus className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Suspense
          fallback={
            <div className="flex h-[400px] w-[350px] items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <EmojiPicker
            onEmojiClick={handleEmojiClick}
            lazyLoadEmojis={true}
            width={350}
            height={400}
            searchPlaceholder="Search emoji..."
          />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}
