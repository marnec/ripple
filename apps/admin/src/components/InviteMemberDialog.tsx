import { Field, FormDialog } from "@/components/console";
import { errorMessage } from "@/lib/errors";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Input } from "@ripple/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ripple/ui/components/select";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Send a workspace invite from the console. Shared by the Invites page (where
 * the operator picks the target workspace) and the workspace detail page (where
 * it is already decided, so the picker collapses to a read-only line).
 *
 * The invited address does not need an account — accepting the invite is what
 * creates one, which is the only remaining route in now that self-signup is
 * closed on the login screen.
 */
export function InviteMemberDialog({
  open,
  workspaceId,
  workspaceName,
  onClose,
}: {
  open: boolean;
  /** Pre-decided target. Omit to let the operator choose one. */
  workspaceId?: Id<"workspaces">;
  /** Display name for the pre-decided target. */
  workspaceName?: string;
  onClose: () => void;
}) {
  const invite = useMutation(api.admin.invites.create);
  // Only subscribed while the picker is actually on screen: this is the
  // console's whole-table workspace listing, and the detail page has no use
  // for it.
  const workspaces = useQuery(
    api.admin.workspaces.list,
    open && !workspaceId ? {} : "skip",
  );

  const [email, setEmail] = useState("");
  // `null` rather than "" so the Select renders its placeholder.
  const [picked, setPicked] = useState<Id<"workspaces"> | null>(null);
  const [busy, setBusy] = useState(false);

  // Clear the form when the dialog (re)opens — during render via the
  // previous-value pattern, matching TypeToConfirmDialog.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setEmail("");
      setPicked(null);
    }
  }

  const targetId = workspaceId ?? picked;

  const submit = () => {
    if (!targetId) return;
    setBusy(true);
    void invite({ workspaceId: targetId, email })
      .then(() => {
        toast.success(`Invite sent to ${email.trim().toLowerCase()}.`);
        onClose();
      })
      .catch((err: unknown) => toast.error(errorMessage(err)))
      .finally(() => setBusy(false));
  };

  return (
    <FormDialog
      open={open}
      title="Invite someone"
      description="Sends the workspace invite email. They join by opening the link — no account needed beforehand."
      submitLabel="Send invite"
      loading={busy}
      canSubmit={Boolean(targetId) && email.trim() !== ""}
      onSubmit={submit}
      onCancel={onClose}
    >
      <Field label="Workspace" htmlFor="invite-workspace">
        {workspaceId ? (
          <div className="rounded-md border border-input px-3 py-1.5 text-sm">
            {workspaceName ?? workspaceId}
          </div>
        ) : (
          <Select
            value={picked}
            disabled={workspaces === undefined}
            onValueChange={setPicked}
          >
            <SelectTrigger id="invite-workspace" className="h-9 w-full">
              {/* A function child owns the label outright — base-ui ignores
                  `placeholder` as soon as one is given — so the unselected case
                  is spelled out here rather than delegated. */}
              <SelectValue>
                {(value: Id<"workspaces"> | null) =>
                  value === null
                    ? workspaces === undefined
                      ? "Loading…"
                      : "Choose a workspace…"
                    : (workspaces?.find((w) => w._id === value)?.name ?? value)
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {workspaces?.map((w) => (
                <SelectItem key={w._id} value={w._id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      <Field
        label="Email"
        htmlFor="invite-email"
        hint="They join as a member. Promote them from the workspace's own settings."
      >
        <Input
          id="invite-email"
          type="email"
          required
          autoFocus={Boolean(workspaceId)}
          placeholder="someone@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
    </FormDialog>
  );
}
