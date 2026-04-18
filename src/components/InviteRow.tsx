import { Button } from "@/components/ui/button";
import { useMutation } from "convex/react";
import { Check, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export interface PendingInvite {
  _id: Id<"workspaceInvites">;
  inviterName: string;
  workspace: { name: string } | null;
}

export function InviteRow({
  invite,
  onAccepted,
}: {
  invite: PendingInvite;
  onAccepted?: () => void;
}) {
  const acceptInvite = useMutation(api.workspaceInvites.accept);
  const declineInvite = useMutation(api.workspaceInvites.decline);
  const navigate = useNavigate();
  const workspaceName = invite.workspace?.name ?? "workspace";

  const handleAccept = () => {
    acceptInvite({ inviteId: invite._id })
      .then(() => {
        toast.success("Invitation accepted", {
          description: `You joined ${workspaceName}`,
        });
        onAccepted?.();
        void navigate("/");
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Something went wrong";
        if (message.toLowerCase().includes("already a member")) {
          toast("Already a member", { description: `You're already in ${workspaceName}` });
          onAccepted?.();
        } else {
          toast.error("Error", { description: message });
        }
      });
  };

  const handleDecline = () => {
    declineInvite({ inviteId: invite._id })
      .then(() => {
        toast("Invitation declined");
      })
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
          {invite.workspace?.name ?? "Unknown workspace"}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          Invited by {invite.inviterName}
        </p>
      </div>
      <div className="flex gap-1.5 shrink-0">
        <Button size="sm" className="h-8 gap-1" onClick={handleAccept}>
          <Check className="size-3.5" />
          Accept
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 px-2 text-muted-foreground hover:text-destructive"
          onClick={handleDecline}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
