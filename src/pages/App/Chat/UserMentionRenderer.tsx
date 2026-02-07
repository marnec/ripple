import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";

export const UserMentionRenderer = ({ userId }: { userId: string }) => {
  const user = useQuery(api.users.get, { id: userId as Id<"users"> });

  if (user === undefined) {
    return <Skeleton className="h-5 w-16 rounded inline-block align-middle" />;
  }

  if (user === null) {
    return (
      <span className="text-muted-foreground align-middle">@unknown-user</span>
    );
  }

  return (
    <span className="font-bold text-foreground align-middle">
      @{user.name || "Unknown"}
    </span>
  );
};
