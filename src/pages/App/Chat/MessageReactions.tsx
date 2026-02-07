import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { TooltipProvider } from "../../../components/ui/tooltip";
import { MessageReactionPill } from "./MessageReactionPill";

type Props = {
  messageId: Id<"messages">;
};

type Reaction = {
  emoji: string;
  emojiNative: string;
  count: number;
  userIds: string[];
  currentUserReacted: boolean;
};

export function MessageReactions({ messageId }: Props) {
  const reactions = useQuery(api.messageReactions.listForMessage, { messageId });

  // Collect all unique user IDs from all reactions (cast to Id<"users"> for query)
  const allUserIds = reactions?.flatMap((r) => r.userIds) ?? [];
  const uniqueUserIds = Array.from(new Set(allUserIds)) as Id<"users">[];

  // Batch-fetch all users in a single query
  const userMap = useQuery(api.users.getByIds, { ids: uniqueUserIds });

  if (!reactions || reactions.length === 0 || !userMap) {
    return null;
  }

  return (
    <TooltipProvider>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {reactions.map((reaction: Reaction) => (
          <MessageReactionPill
            key={reaction.emoji}
            messageId={messageId}
            emoji={reaction.emoji}
            emojiNative={reaction.emojiNative}
            count={reaction.count}
            userIds={reaction.userIds}
            currentUserReacted={reaction.currentUserReacted}
            userMap={userMap}
          />
        ))}
      </div>
    </TooltipProvider>
  );
}
