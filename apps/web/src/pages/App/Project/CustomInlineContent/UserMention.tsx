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
    // What the mention becomes outside the editor — in the markdown
    // `blocksToMarkdownLossy` posts for the GitHub / GitLab push. The browser
    // cannot know the person's provider login, so it emits a stable token and
    // the dispatch layer rewrites it server-side
    // (`integrations/core/mentionTokens.ts`). Without this export the mention
    // was dropped and "ping @Marco" reached the issue as "ping ". No markdown
    // -special characters, so the token survives the HTML → markdown pass.
    toExternalHTML: ({ inlineContent }) => {
      const { userId } = inlineContent.props;
      return <span>{userId ? `@user:${userId}` : "@unknown-user"}</span>;
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
