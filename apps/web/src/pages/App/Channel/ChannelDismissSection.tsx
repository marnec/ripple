import { Button } from "@ripple/ui/components/button";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { removeFromKnownChannels } from "@/hooks/use-acknowledged-channels";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { EyeOff } from "lucide-react";
import { exitCopy } from "@/lib/channel-exit";
import type { ChannelLike } from "@ripple/shared/channel";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

interface ChannelDismissSectionProps {
  channelId: Id<"channels">;
  workspaceId: Id<"workspaces">;
  /**
   * The conversation itself, rather than an `isDm` flag derived from it by the
   * parent. A DM is "closed" and a public channel is "hidden" — same mutation
   * and the same per-user dismissal, but different words — and `exitCopy` is
   * where that difference is stated, so this component asks rather than being
   * told.
   */
  channel: ChannelLike;
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
  channel,
}: ChannelDismissSectionProps) {
  const navigate = useNavigate();
  const copy = exitCopy(channel);
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
        toast.error(copy.dismissFailed, {
          description:
            error instanceof ConvexError ? String(error.data) : "Please try again",
        });
      });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{copy.explanation}</p>
      <Button variant="outline" onClick={handleDismiss}>
        <EyeOff className="w-4 h-4 mr-2" />
        {copy.dismiss}
      </Button>
    </div>
  );
}
