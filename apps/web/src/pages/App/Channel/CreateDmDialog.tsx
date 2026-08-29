import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@ripple/ui/components/button";
import { Combobox } from "@/components/ui/Combobox";
import { useViewer } from "../UserContext";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "../../../components/ui/responsive-dialog";

export interface CreateDmDialogProps {
  workspaceId: Id<"workspaces">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Sidebar labels of the direct messages the viewer already has. A DM's label
   * *is* the other participant's display name (`dmLabelForViewer`), so this
   * doubles as "who am I already talking to" without a second query.
   *
   * Two members sharing a display name would make this say "Open" for a
   * conversation that is about to be created. That is the whole cost of the
   * false positive: `createDm` decides for itself whether to reuse or create,
   * and either way we navigate to what it returns. The label is the only thing
   * riding on this set.
   */
  existingConversationLabels: Set<string>;
}

/**
 * Starting a direct message. Deliberately not a mode of `CreateChannelDialog`:
 * the two forms share no field, no validation and no destination, and the one
 * thing they did share — being the same component — is what made both of them
 * change shape as the member filled them in.
 */
export function CreateDmDialog({
  workspaceId,
  open,
  onOpenChange,
  existingConversationLabels,
}: CreateDmDialogProps) {
  const createDm = useMutation(api.channels.createDm);
  const currentUser = useViewer();
  const workspaceMembers = useQuery(api.workspaceMembers.membersWithRoles, { workspaceId });
  const navigate = useNavigate();

  const picker = useRef<HTMLButtonElement | null>(null);
  const [picked, setPicked] = useState<{ userId: string; name: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) picker.current?.focus();
  }, [open]);

  // Clearing the pick belongs to the close event, not to an effect watching
  // `open` — resetting state from an effect costs a second render pass every
  // time the dialog closes.
  const handleOpenChange = (next: boolean) => {
    if (!next) setPicked(null);
    onOpenChange(next);
  };

  // Bot accounts are already excluded by `membersWithRoles`; only the viewer
  // has to be dropped here, because a DM with yourself is refused server-side.
  const candidates =
    workspaceMembers
      ?.filter((m) => m.userId !== currentUser?._id)
      .map((m) => ({ value: m.userId, label: m.name })) ?? [];

  const alreadyTalking = picked !== null && existingConversationLabels.has(picked.name);

  const submit = async () => {
    if (!picked || submitting) return;
    setSubmitting(true);
    try {
      // `createDm` deduplicates and returns the existing conversation when
      // there is one, so there is nothing to branch on here — we navigate to
      // whatever it hands back.
      const channelId = await createDm({
        workspaceId,
        otherUserId: picked.userId as Id<"users">,
      });
      handleOpenChange(false);
      void navigate(`/workspaces/${workspaceId}/channels/${channelId}`);
    } catch {
      toast.error("Couldn't start the conversation", {
        description: "Please try again later",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange} direction="top">
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>New Direct Message</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Start a 1-on-1 conversation with another workspace member
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            className="space-y-4"
          >
            <Combobox
              ref={picker}
              className="w-full"
              value={picked?.userId}
              label={picked?.name}
              items={candidates}
              onSelect={(value, label) =>
                setPicked(value ? { userId: value, name: label ?? "" } : null)
              }
              selectItemMsg="Select a workspace member"
              searchPlaceholder="Search members..."
              noResultsMsg="No members found"
            />
            <ResponsiveDialogFooter>
              <Button type="submit" disabled={!picked || submitting}>
                {alreadyTalking ? "Open conversation" : "Start conversation"}
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
