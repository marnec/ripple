import { Button } from "../../../components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "../../../components/ui/responsive-dialog";
import { Input } from "../../../components/ui/input";
import { toast } from "sonner";
import { useMutation } from "convex/react";
import { FormEvent, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

export function InviteUserDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: Id<"workspaces">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const createInvite = useMutation(api.workspaceInvites.create);
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await createInvite({ email, workspaceId });
      toast.success("Invitation sent", {
        description: `Successfully invited ${email} to the workspace`,
      });
      setEmail("");
      onOpenChange(false);
    } catch (error) {
      toast.error("Error sending invitation", {
        description:
          error instanceof Error ? error.message : "Please try again later",
      });
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} direction="top">
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Invite User</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Invite a user to join this workspace
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                Email Address
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter email address"
                required
              />
            </div>
            <ResponsiveDialogFooter>
              <Button type="submit" disabled={!email}>
                Send Invitation
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
