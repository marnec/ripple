import { createReactInlineContentSpec } from "@blocknote/react";
import { useQuery } from "convex-helpers/react/cache";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserDisplayName } from "@/hooks/use-user-display-name";

export const UserMention = createReactInlineContentSpec(
  {
    type: "userMention",
    propSchema: {
      userId: {
        default: "",
      },
    },
    content: "none",
  } as const,
  {
    render: ({ inlineContent }) => {
      const { userId } = inlineContent.props;
      if (!userId) {
        return (
          <span className="text-muted-foreground align-middle">@unknown-user</span>
        );
      }
      return <UserMentionView userId={userId as Id<"users">} />;
    },
  }
);

const UserMentionView = ({ userId }: { userId: Id<"users"> }) => {
  const user = useQuery(api.users.get, { id: userId });
  // `users.get` withholds `email`, so a nameless account resolves its label
  // from the workspace member list — see `useUserDisplayName`.
  const displayName = useUserDisplayName(userId, user);

  if (user === undefined) {
    return <Skeleton className="h-5 w-16 rounded inline-block align-middle" />;
  }

  if (user === null) {
    return (
      <span className="text-muted-foreground align-middle">@unknown-user</span>
    );
  }

  return (
    <span className="font-bold text-foreground align-middle" contentEditable={false}>
      @{displayName}
    </span>
  );
};
