import { cn } from "@/lib/utils";
import { getUserDisplayName } from "@shared/displayName";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";

type Props = {
  messageId: Id<"messages">;
  emoji: string;
  emojiNative: string;
  count: number;
  userIds: string[];
  currentUserReacted: boolean;
  userMap: Record<string, { name?: string; email?: string }>;
};

export function MessageReactionPill({
  messageId,
  emoji,
  emojiNative,
  count,
  userIds,
  currentUserReacted,
  userMap,
}: Props) {
  const toggleReaction = useMutation(api.messageReactions.toggle);

  const handleClick = () => {
    void toggleReaction({ messageId, emoji, emojiNative });
  };

  // Build tooltip content with user names
  const tooltipContent = userIds
    .map((userId) => {
      const user = userMap[userId];
      return getUserDisplayName(user);
    })
    .join(", ");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handleClick}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm transition-colors hover:bg-accent",
            "cursor-pointer",
            currentUserReacted &&
              "border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950"
          )}
        >
          <span>{emojiNative}</span>
          <span className="text-xs text-muted-foreground">{count}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <div className="text-xs">{tooltipContent}</div>
      </TooltipContent>
    </Tooltip>
  );
}
