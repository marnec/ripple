import { useQuery } from "convex-helpers/react/cache";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { UserAvatar } from "@/components/UserAvatar";
import { useUserDisplayName } from "@/hooks/use-user-display-name";
import { useMentionedUsers } from "./MentionedUsersContext";

const MentionChip = ({ name, image }: { name: string; image?: string }) => (
  <span className="inline-flex items-center gap-1 px-1.5 pr-2 py-0.5 rounded-full bg-blue-500/10 dark:bg-blue-400/10 text-blue-700 dark:text-blue-300 text-sm font-medium align-middle transition-colors hover:bg-blue-500/20 dark:hover:bg-blue-400/20">
    <UserAvatar
      name={name}
      image={image}
      alt={name}
      className="h-4 w-4 text-[8px]"
      fallbackClassName="bg-blue-500/20 dark:bg-blue-400/20 text-blue-700 dark:text-blue-300 text-[8px] font-semibold"
    />
    {name}
  </span>
);

export const UserMentionRenderer = ({ userId }: { userId: string }) => {
  const mentionedUsers = useMentionedUsers();
  const cached = mentionedUsers[userId];

  // Skip the query if we already have the user from server-side batch resolution
  const user = useQuery(api.users.get, cached ? "skip" : { id: userId as Id<"users"> });
  // Neither source carries `email`, so the nameless case is resolved against
  // the workspace member list — see `useUserDisplayName`.
  const displayName = useUserDisplayName(userId, cached ?? user);

  // Use cached data from server context if available
  if (cached) {
    return <MentionChip name={displayName} image={cached.image} />;
  }

  // Fallback: fetch via query (used outside message context, e.g., editor preview)
  if (user === undefined) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-500/10 dark:bg-blue-400/10 align-middle">
        <span className="animate-pulse bg-muted h-4 w-4 rounded-full shrink-0 inline-block" />
        <span className="animate-pulse bg-muted h-3.5 w-14 rounded inline-block" />
      </span>
    );
  }

  if (user === null) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-background/60 text-muted-foreground text-sm align-middle">
        unknown-user
      </span>
    );
  }

  return <MentionChip name={displayName} image={user.image} />;
};
