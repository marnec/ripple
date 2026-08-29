import { Button } from "@ripple/ui/components/button";
import { Input } from "@ripple/ui/components/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useMutation } from "convex/react";
import { Globe, Lock } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ChannelVisibility } from "@ripple/shared/enums";
import {
  CHANNEL_VISIBILITY_DESCRIPTION,
  CHANNEL_VISIBILITY_LABEL,
  type ChannelVisibilityValue,
} from "@/lib/channel-visibility";

interface ChannelDetailsSectionProps {
  channelId: Id<"channels">;
  channelName: string;
  /** Only a channel reaches this section, so it always has one. */
  channelVisibility: ChannelVisibilityValue | undefined;
  isAdmin: boolean;
}

export function ChannelDetailsSection({
  channelId,
  channelName: serverName,
  channelVisibility,
  isAdmin,
}: ChannelDetailsSectionProps) {
  const updateChannel = useMutation(api.channels.update);
  const [localName, setLocalName] = useState<string | null>(null);

  const displayName = localName ?? serverName;
  const hasChanges = localName !== null;

  const handleSave = async () => {
    try {
      await updateChannel({
        id: channelId,
        ...(localName !== null && { name: localName }),
      });
      toast.success("Channel updated");
      setLocalName(null);
    } catch (error) {
      toast.error("Error updating channel", {
        description: error instanceof Error ? error.message : "Please try again",
      });
    }
  };

  return (
    <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="channel-name">Channel Name</Label>
          <Input
            id="channel-name"
            value={displayName}
            onChange={(e) => setLocalName(e.target.value)}
            placeholder="Enter channel name"
            disabled={!isAdmin}
          />
        </div>

        <div className="space-y-2">
          <Label>Visibility</Label>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {/* No direct-message branch: this section is only ever rendered for
                a channel, and a channel is the only thing that has a
                visibility. The prop makes that unrepresentable rather than
                merely unreached. */}
            {channelVisibility === ChannelVisibility.PUBLIC ? (
              <Globe className="w-4 h-4" />
            ) : (
              <Lock className="w-4 h-4" />
            )}
            {channelVisibility && (
              <span>
                {CHANNEL_VISIBILITY_LABEL[channelVisibility]} —{" "}
                {CHANNEL_VISIBILITY_DESCRIPTION[channelVisibility]}
              </span>
            )}
          </div>
        </div>

        {hasChanges && isAdmin && (
          <Button onClick={() => void handleSave()}>Save Changes</Button>
        )}
    </div>
  );
}
