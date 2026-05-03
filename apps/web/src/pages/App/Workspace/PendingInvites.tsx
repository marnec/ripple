import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { InviteRow } from "@/components/InviteRow";
import { usePendingInvites } from "@/hooks/use-pending-invites";

export function PendingInvitesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const invites = usePendingInvites();

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Pending Invitations</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Workspace invitations waiting for your response
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          {invites.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No pending invitations
            </p>
          ) : (
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {invites.map((invite) => (
                <InviteRow
                  key={invite._id}
                  invite={invite}
                  onAccepted={() => onOpenChange(false)}
                />
              ))}
            </div>
          )}
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
