import { createReactInlineContentSpec } from "@blocknote/react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";
import { getUserDisplayName } from "@shared/displayName";

export const UserMention = createReactInlineContentSpec(
  {
    type: "userMention",
    propSchema: {
      userId: {
        default: "" as unknown as string,
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
      @{getUserDisplayName(user)}
    </span>
  );
};
