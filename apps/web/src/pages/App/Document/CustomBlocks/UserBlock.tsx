import { createReactInlineContentSpec } from "@blocknote/react";
import { useQuery } from "convex-helpers/react/cache";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { UserAvatar } from "@/components/UserAvatar";
import { useUserDisplayName } from "@/hooks/use-user-display-name";
import { Skeleton } from "../../../../components/ui/skeleton";

const UserView = ({ userId }: { userId: Id<"users"> }) => {
  const user = useQuery(api.users.get, { id: userId });
  // `users.get` withholds `email`, so a nameless account resolves its label
  // from the workspace member list — see `useUserDisplayName`.
  const displayName = useUserDisplayName(userId, user);

  if (!user) {
    return <Skeleton className="inline-block h-6 w-24 rounded-full" />;
  }

  return (
    <span className="align-middle inline-flex items-center gap-1 p-1 rounded-full bg-muted">
      <UserAvatar name={displayName} image={user.image} className="h-5 w-5" />
      <span className="font-medium">{displayName}</span>
    </span>
  );
};

export const User = createReactInlineContentSpec(
  {
    type: "mention",
    propSchema: {
      userId: {
        default: null as unknown as Id<"users">,
      },
    },
    content: "none",
  } as const,
  {
    render: ({ inlineContent }) => {
      const { userId } = inlineContent.props;

      if (!userId) {
        return (
          <span className="align-middle inline-flex items-center gap-1 p-1 rounded-full bg-destructive/20">
            <span className="font-medium">@Unknown User</span>
          </span>
        );
      }
      return <UserView userId={userId as Id<"users">} />;
    },
  },
);