import { useQuery } from "convex-helpers/react/cache";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useUserDisplayName } from "@/hooks/use-user-display-name";
import { useMentionedUsers } from "./MentionedUsersContext";
import {
  UnknownUserMention,
  UserMentionChip,
  UserMentionPlaceholder,
} from "./UserMentionChip";

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
    return <UserMentionChip userId={userId} name={displayName} image={cached.image} />;
  }

  // Fallback: fetch via query (used outside message context, e.g., editor preview)
  if (user === undefined) return <UserMentionPlaceholder />;
  if (user === null) return <UnknownUserMention />;

  return <UserMentionChip userId={userId} name={displayName} image={user.image} />;
};
