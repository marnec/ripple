import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InviteRow } from "@/components/InviteRow";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { usePendingInvites } from "@/hooks/use-pending-invites";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { Bell, Check, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

type PendingJoinRequest = {
  _id: Id<"channelJoinRequests">;
  channelId: Id<"channels">;
  channelName: string;
  workspaceId: Id<"workspaces">;
  workspaceName: string;
  userId: Id<"users">;
  userName: string;
};

function JoinRequestRow({ request }: { request: PendingJoinRequest }) {
  const approve = useMutation(api.channels.approveJoinRequest);
  const deny = useMutation(api.channels.denyJoinRequest);

  const handleApprove = () => {
    approve({ requestId: request._id })
      .then(() => toast.success(`${request.userName} added to #${request.channelName}`))
      .catch((err: unknown) => {
        toast.error("Error", {
          description: err instanceof Error ? err.message : "Something went wrong",
        });
      });
  };

  const handleDeny = () => {
    deny({ requestId: request._id })
      .then(() => toast("Request declined"))
      .catch((err: unknown) => {
        toast.error("Error", {
          description: err instanceof Error ? err.message : "Something went wrong",
        });
      });
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">
          {request.userName}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          wants to join #{request.channelName}
        </p>
      </div>
      <div className="flex gap-1.5 shrink-0">
        <Button size="sm" className="h-8 gap-1" onClick={handleApprove}>
          <Check className="size-3.5" />
          Approve
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 px-2 text-muted-foreground hover:text-destructive"
          onClick={handleDeny}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function NotificationDrawer() {
  const pendingInvites = usePendingInvites();
  const joinRequests = useQuery(api.channels.listPendingRequestsForAdmin, {}) ?? [];
  const totalCount = pendingInvites.length + joinRequests.length;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            aria-label="Notifications"
            className="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          />
        }
      >
        <Bell className="size-4" />
        {totalCount > 0 && (
          <Badge className="absolute -top-1 -right-1 h-4 min-w-4 justify-center rounded-full px-1 text-[10px]">
            {totalCount}
          </Badge>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        className="w-80 max-h-96 overflow-y-auto"
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Notifications</p>
            {totalCount === 0 && (
              <span className="text-xs text-muted-foreground">
                You're all caught up
              </span>
            )}
          </div>

          {pendingInvites.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Workspace invitations
              </p>
              <div className="flex flex-col gap-2">
                {pendingInvites.map((invite) => (
                  <InviteRow key={invite._id} invite={invite} />
                ))}
              </div>
            </div>
          )}

          {joinRequests.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Channel join requests
              </p>
              <div className="flex flex-col gap-2">
                {joinRequests.map((request) => (
                  <JoinRequestRow key={request._id} request={request} />
                ))}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
