import { Button } from "@ripple/ui/components/button";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { removeFromKnownChannels } from "@/hooks/use-acknowledged-channels";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { EyeOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

interface ChannelDismissSectionProps {
  channelId: Id<"channels">;
  workspaceId: Id<"workspaces">;
  /** A DM is "closed", a public channel is "hidden" — same mutation, and the
   *  same per-user dismissal, but they differ in how they come back. */
  isDm: boolean;
}

/**
 * The settings-page twin of the sidebar's "Close conversation" / "Hide from
 * sidebar" item. Dismissal is per-user view state — it deletes nothing and
 * notifies nobody (see `convex/channelDismissal.ts`).
 *
 * Private channels are deliberately absent: those are *left*, not dismissed,
 * and the backend rejects dismissing one.
 */
export function ChannelDismissSection({
  channelId,
  workspaceId,
  isDm,
}: ChannelDismissSectionProps) {
  const navigate = useNavigate();
  const dismissChannel = useMutation(api.channelDismissal.dismissChannel);

  const handleDismiss = () => {
    dismissChannel({ channelId })
      .then(() => {
        // Drop it from the known-channels list the way the delete flow does,
        // so the sidebar absorbs the disappearance instead of rendering it as
        // a ghost item someone else removed.
        removeFromKnownChannels(workspaceId, channelId);
        // Same reason the sidebar navigates away: staying on the settings page
        // of a channel the sidebar no longer lists is a dead end.
        void navigate(`/workspaces/${workspaceId}/channels`);
      })
      .catch((error: unknown) => {
        toast.error(isDm ? "Couldn't close conversation" : "Couldn't hide channel", {
          description:
            error instanceof ConvexError ? String(error.data) : "Please try again",
        });
      });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {isDm
          ? "This removes the conversation from your sidebar. Nothing is deleted and the other person is not notified — it comes back on their next message."
          : "This removes the channel from your sidebar, for you only. Nothing is deleted and nobody else is affected — you stay a member, and the eye toggle beside the sidebar's Channels heading brings it back."}
      </p>
      <Button variant="outline" onClick={handleDismiss}>
        <EyeOff className="w-4 h-4 mr-2" />
        {isDm ? "Close conversation" : "Hide from sidebar"}
      </Button>
    </div>
  );
}
