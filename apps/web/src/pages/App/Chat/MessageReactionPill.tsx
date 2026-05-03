import { cn } from "@/lib/utils";
import { getUserDisplayName } from "@ripple/shared/displayName";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
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

  const tooltipContent = userIds
    .map((userId) => getUserDisplayName(userMap[userId]))
    .join(", ");

  return (
    <Tooltip>
      <TooltipTrigger
        render={<button
          onClick={handleClick}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-sm transition-colors hover:bg-accent/60 cursor-pointer -ml-1.5",
            currentUserReacted ? "bg-blue-100 dark:bg-blue-950" : "bg-black/5 dark:bg-white/10",
          )}
        />}
      >
        <span className="inline-flex h-5 w-5 items-center justify-center leading-none">{emojiNative}</span>
        <span className="text-xs text-muted-foreground">{count}</span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="text-xs">{tooltipContent}</div>
      </TooltipContent>
    </Tooltip>
  );
}
