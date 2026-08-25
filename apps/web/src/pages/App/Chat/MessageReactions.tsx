import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { TooltipProvider } from "@ripple/ui/components/tooltip";
import { MessageReactionPill } from "./MessageReactionPill";
import type { MessageReaction } from "@convex/types/channel";

type Props = {
  messageId: Id<"messages">;
  reactions: MessageReaction[];
};

export function MessageReactions({ messageId, reactions }: Props) {
  // Collect all unique user IDs from all reactions (cast to Id<"users"> for query)
  const allUserIds = reactions.flatMap((r) => r.userIds);
  const uniqueUserIds = Array.from(new Set(allUserIds)) as Id<"users">[];

  // Batch-fetch all users in a single query
  const userMap = useQuery(api.users.getByIds, uniqueUserIds.length > 0 ? { ids: uniqueUserIds } : "skip");

  if (reactions.length === 0) {
    return null;
  }

  return (
    <TooltipProvider>
      <div className="flex flex-wrap items-center gap-1">
        {reactions.map((reaction) => (
          <MessageReactionPill
            key={reaction.emoji}
            messageId={messageId}
            emoji={reaction.emoji}
            emojiNative={reaction.emojiNative}
            count={reaction.count}
            userIds={reaction.userIds}
            currentUserReacted={reaction.currentUserReacted}
            userMap={userMap ?? {}}
          />
        ))}
      </div>
    </TooltipProvider>
  );
}
