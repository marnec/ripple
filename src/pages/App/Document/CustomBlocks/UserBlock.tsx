import { createReactInlineContentSpec } from "@blocknote/react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { Avatar, AvatarFallback, AvatarImage } from "../../../../components/ui/avatar";
import { Skeleton } from "../../../../components/ui/skeleton";

const UserView = ({ userId }: { userId: Id<"users"> }) => {
  const user = useQuery(api.users.get, { id: userId });

  if (!user) {
    return <Skeleton className="inline-block h-6 w-24 rounded-full" />;
  }

  return (
    <span className="align-middle inline-flex items-center gap-1 p-1 rounded-full bg-muted">
      <Avatar className="h-5 w-5">
        <AvatarImage src={user.image} />
        <AvatarFallback>
          {user.name?.charAt(0).toLocaleUpperCase() || "U"}
        </AvatarFallback>
      </Avatar>
      <span className="font-medium">{user.name || "Unknown User"}</span>
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