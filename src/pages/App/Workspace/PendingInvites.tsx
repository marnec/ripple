import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { useMutation } from "convex/react";
import { Check, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { usePendingInvites } from "@/hooks/use-pending-invites";

export function PendingInvitesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const invites = usePendingInvites();
  const acceptInvite = useMutation(api.workspaceInvites.accept);
  const declineInvite = useMutation(api.workspaceInvites.decline);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleAccept = async (inviteId: Id<"workspaceInvites">, workspaceName: string) => {
    try {
      await acceptInvite({ inviteId });
      toast({
        title: "Invitation accepted",
        description: `You joined ${workspaceName}`,
      });
      onOpenChange(false);
      void navigate("/");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      if (message.toLowerCase().includes("already a member")) {
        toast({ title: "Already a member", description: `You're already in ${workspaceName}` });
        onOpenChange(false);
      } else {
        toast({ title: "Error", description: message, variant: "destructive" });
      }
    }
  };

  const handleDecline = async (inviteId: Id<"workspaceInvites">) => {
    try {
      await declineInvite({ inviteId });
      toast({ title: "Invitation declined" });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Something went wrong",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pending Invitations</DialogTitle>
          <DialogDescription>
            Workspace invitations waiting for your response
          </DialogDescription>
        </DialogHeader>
        {invites.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No pending invitations
          </p>
        ) : (
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {invites.map((invite) => (
              <div
                key={invite._id}
                className="flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {invite.workspace?.name ?? "Unknown workspace"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    Invited by {invite.inviterName}
                  </p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    className="h-8 gap-1"
                    onClick={() => void handleAccept(invite._id, invite.workspace?.name ?? "workspace")}
                  >
                    <Check className="size-3.5" />
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-muted-foreground hover:text-destructive"
                    onClick={() => void handleDecline(invite._id)}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
