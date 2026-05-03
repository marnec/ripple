import { Button } from "@/components/ui/button";
import { Lock, Users } from "lucide-react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { ConvexError } from "convex/values";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

interface ClosedChannelGateProps {
  channelId: Id<"channels">;
  name: string;
  memberCount: number;
}

export function ClosedChannelGate({
  channelId,
  name,
  memberCount,
}: ClosedChannelGateProps) {
  const requestJoin = useMutation(api.channels.requestJoin);
  const pendingRequest = useQuery(api.channels.getMyPendingRequest, { channelId });
  const hasPending = pendingRequest !== undefined && pendingRequest !== null;

  const handleRequest = () => {
    requestJoin({ channelId })
      .then(() => {
        toast.success("Request sent to channel admins");
      })
      .catch((error) => {
        if (error instanceof ConvexError) {
          toast.error("Error", { description: String(error.data) });
        }
      });
  };

  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center max-w-sm">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-muted">
          <Lock className="w-6 h-6 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold">#{name}</h2>
        <p className="text-sm text-muted-foreground">
          This is a closed channel. Only invited members can see messages and participate.
        </p>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="w-3.5 h-3.5" />
          <span>{memberCount} {memberCount === 1 ? "member" : "members"}</span>
        </div>
        {hasPending ? (
          <>
            <Button disabled>Request pending</Button>
            <p className="text-xs text-muted-foreground">
              Your request is awaiting approval.
            </p>
          </>
        ) : (
          <Button onClick={handleRequest}>
            Ask to Join
          </Button>
        )}
      </div>
    </div>
  );
}
