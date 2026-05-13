import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useViewer } from "../UserContext";
import { useQuery } from "convex-helpers/react/cache";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

interface LeaveChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: Id<"channels">;
  channelName: string;
  /** Called after a successful leave so the caller can navigate away, clear
   *  sidebar memory, etc. Receives the leaving user's id. */
  onLeft?: (userId: Id<"users">) => void;
}

/**
 * Leave-channel confirmation. Two flows:
 *
 *   1. Normal leave: simple confirm, calls `removeFromChannel({ userId: me })`.
 *   2. Last-admin leave: shows a member picker. The picked user is promoted
 *      to admin in the SAME transaction as the leave via the mutation's
 *      `transferAdminTo` arg — one OCC commit instead of "promote then leave."
 *
 * Pre-flights via `amILastAdmin` so the UI shows the right state up front
 * instead of erroring after the user clicks Leave.
 */
export function LeaveChannelDialog({
  open,
  onOpenChange,
  channelId,
  channelName,
  onLeft,
}: LeaveChannelDialogProps) {
  const viewer = useViewer();
  const isLastAdmin = useQuery(
    api.channelMembers.amILastAdmin,
    open ? { channelId } : "skip",
  );
  const members = useQuery(
    api.channelMembers.membersByChannel,
    open && isLastAdmin === true ? { channelId } : "skip",
  );
  const removeFromChannel = useMutation(api.channelMembers.removeFromChannel);

  const [transferTo, setTransferTo] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  // While we don't yet know whether the caller is the last admin, treat the
  // dialog as still loading. Showing the wrong copy and then swapping would
  // feel worse than a brief delay.
  const loading = isLastAdmin === undefined || viewer === undefined;

  const eligibleMembers = members?.filter((m) => m.userId !== viewer?._id) ?? [];

  const handleLeave = async () => {
    if (!viewer) return;
    if (isLastAdmin && !transferTo) return;
    setSubmitting(true);
    try {
      await removeFromChannel({
        channelId,
        userId: viewer._id,
        ...(isLastAdmin && transferTo
          ? { transferAdminTo: transferTo as Id<"users"> }
          : {}),
      });
      toast.success(`You left ${channelName}`);
      onOpenChange(false);
      onLeft?.(viewer._id);
    } catch (error) {
      toast.error("Couldn't leave channel", {
        description:
          error instanceof ConvexError ? String(error.data) : "Please try again",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Leave {channelName}?</DialogTitle>
          <DialogDescription>
            {loading
              ? "Checking channel state…"
              : isLastAdmin
                ? "You're the only admin. Pick another member to promote to admin before leaving."
                : "You'll need to be re-invited to rejoin."}
          </DialogDescription>
        </DialogHeader>

        {!loading && isLastAdmin && (
          <div className="py-2">
            {eligibleMembers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You're the only member. Delete the channel from settings instead.
              </p>
            ) : (
              <Select value={transferTo} onValueChange={(v) => { if (v) setTransferTo(v); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Promote to admin…" />
                </SelectTrigger>
                <SelectContent>
                  {eligibleMembers.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void handleLeave()}
            disabled={
              loading ||
              submitting ||
              (isLastAdmin === true &&
                (eligibleMembers.length === 0 || !transferTo))
            }
          >
            {isLastAdmin ? "Promote and leave" : "Leave channel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
