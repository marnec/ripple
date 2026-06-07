import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { ConvexError } from "convex/values";
import { formatDistanceToNow } from "date-fns";
import { Mail, RotateCw, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

export function WorkspaceInvitationsSection({
  workspaceId,
}: {
  workspaceId: Id<"workspaces">;
}) {
  const invites = useQuery(api.workspaceInvites.listByWorkspace, { workspaceId });
  const createInvite = useMutation(api.workspaceInvites.create);
  const revokeInvite = useMutation(api.workspaceInvites.revoke);
  const resendInvite = useMutation(api.workspaceInvites.resend);

  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingId, setPendingId] = useState<Id<"workspaceInvites"> | null>(null);
  // The invite awaiting Revoke confirmation (null = dialog closed).
  const [revokeTarget, setRevokeTarget] = useState<{
    inviteId: Id<"workspaceInvites">;
    email: string;
  } | null>(null);

  const describeError = (error: unknown) =>
    error instanceof ConvexError
      ? String(error.data)
      : error instanceof Error
        ? error.message
        : "Please try again";

  const handleInvite = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      await createInvite({ email, workspaceId });
      toast.success("Invitation sent", { description: `Invited ${email}` });
      setEmail("");
    } catch (error) {
      toast.error("Error sending invitation", { description: describeError(error) });
    } finally {
      setSending(false);
    }
  };

  const handleResend = (inviteId: Id<"workspaceInvites">, to: string) => {
    setPendingId(inviteId);
    resendInvite({ inviteId })
      .then(() => toast.success("Invitation resent", { description: `Resent to ${to}` }))
      .catch((error: unknown) =>
        toast.error("Error resending invitation", { description: describeError(error) }),
      )
      .finally(() => setPendingId(null));
  };

  const confirmRevoke = () => {
    if (!revokeTarget) return;
    const { inviteId, email: to } = revokeTarget;
    setRevokeTarget(null);
    setPendingId(inviteId);
    revokeInvite({ inviteId })
      .then(() => toast.success("Invitation revoked", { description: `Revoked ${to}` }))
      .catch((error: unknown) =>
        toast.error("Error revoking invitation", { description: describeError(error) }),
      )
      .finally(() => setPendingId(null));
  };

  return (
    <div className="space-y-6">
      <form onSubmit={(e) => void handleInvite(e)} className="flex gap-2">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          required
          className="flex-1"
        />
        <Button type="submit" disabled={!email || sending}>
          Send invite
        </Button>
      </form>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Pending invitations
        </p>
        {invites === undefined ? (
          // Reserve space; content fades in when loaded (no skeletons).
          <div className="min-h-12" />
        ) : invites.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No pending invitations.
          </p>
        ) : (
          <div className="space-y-2">
            {invites.map((invite) => {
              const busy = pendingId === invite._id;
              return (
                <div
                  key={invite._id}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Mail className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{invite.email}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        Invited by {invite.inviterName} ·{" "}
                        {formatDistanceToNow(invite._creationTime, { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => handleResend(invite._id, invite.email)}
                      title="Resend invitation"
                    >
                      <RotateCw className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        setRevokeTarget({ inviteId: invite._id, email: invite.email })
                      }
                      title="Revoke invitation"
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ResponsiveDialog
        open={revokeTarget !== null}
        onOpenChange={(v) => {
          if (!v) setRevokeTarget(null);
        }}
      >
        <ResponsiveDialogContent className="max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Revoke invitation?</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {revokeTarget && (
                <>
                  Revoke the invitation for{" "}
                  <span className="font-medium">{revokeTarget.email}</span>? Their
                  invite link will stop working. You can always invite them again
                  later.
                </>
              )}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter>
            <Button variant="ghost" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmRevoke}>
              Revoke
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
