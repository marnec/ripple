import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { getUserDisplayName } from "@shared/displayName";
import { useMentionedUsers } from "./MentionedUsersContext";

export const UserMentionRenderer = ({ userId }: { userId: string }) => {
  const mentionedUsers = useMentionedUsers();
  const cached = mentionedUsers[userId];

  // Skip the query if we already have the user from server-side batch resolution
  const user = useQuery(api.users.get, cached ? "skip" : { id: userId as Id<"users"> });

  // Use cached data from server context if available
  if (cached) {
    const displayName = getUserDisplayName(cached);
    const initials = (cached.name || "?")
      .split(" ")
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();

    return (
      <span className="inline-flex items-center gap-1 px-1.5 pr-2 py-0.5 rounded-full bg-blue-500/10 dark:bg-blue-400/10 text-blue-700 dark:text-blue-300 text-sm font-medium align-middle transition-colors hover:bg-blue-500/20 dark:hover:bg-blue-400/20">
        <Avatar className="h-4 w-4 text-[8px]">
          <AvatarImage src={cached.image} alt={displayName} />
          <AvatarFallback className="bg-blue-500/20 dark:bg-blue-400/20 text-blue-700 dark:text-blue-300 text-[8px] font-semibold">
            {initials}
          </AvatarFallback>
        </Avatar>
        {displayName}
      </span>
    );
  }

  // Fallback: fetch via query (used outside message context, e.g., editor preview)
  if (user === undefined) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-500/10 dark:bg-blue-400/10 align-middle">
        <Skeleton className="h-4 w-4 rounded-full shrink-0" />
        <Skeleton className="h-3.5 w-14 rounded" />
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

  const initials = (user.name || "?")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <span className="inline-flex items-center gap-1 px-1.5 pr-2 py-0.5 rounded-full bg-blue-500/10 dark:bg-blue-400/10 text-blue-700 dark:text-blue-300 text-sm font-medium align-middle transition-colors hover:bg-blue-500/20 dark:hover:bg-blue-400/20">
      <Avatar className="h-4 w-4 text-[8px]">
        <AvatarImage src={user.image} alt={user.name || "User"} />
        <AvatarFallback className="bg-blue-500/20 dark:bg-blue-400/20 text-blue-700 dark:text-blue-300 text-[8px] font-semibold">
          {initials}
        </AvatarFallback>
      </Avatar>
      {getUserDisplayName(user)}
    </span>
  );
};
