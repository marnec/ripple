import { Eye } from "lucide-react";

import type { CallParticipant } from "@/components/call/types";
import { useFollowMode } from "@/contexts/FollowModeContext";
import type { Id } from "@convex/_generated/dataModel";

/**
 * Channel-call participant tile overlay: a hover-revealed "Follow"
 * button, swapped for a "Following" badge once active. Authenticated
 * remote participants only — guests (whose `customParticipantId` is
 * prefixed `guest:`) and self are filtered out.
 *
 * Channel-specific because follow mode is a channel feature today; the
 * event surface intentionally doesn't render this.
 */
export function FollowParticipantOverlay({
  participant,
}: {
  participant: CallParticipant;
}) {
  const { startFollowing, isFollowing, followingUserId } = useFollowMode();

  const userId = participant.customParticipantId;
  const isGuest = userId?.startsWith("guest:") ?? false;
  if (!userId || isGuest) return null;

  const isFollowingThis = isFollowing && followingUserId === userId;

  if (isFollowingThis) {
    return (
      <div className="absolute right-2 top-2 flex items-center gap-1 rounded bg-blue-500/80 px-2 py-1 text-xs text-white">
        <Eye className="h-3 w-3" />
        Following
      </div>
    );
  }

  return (
    <button
      className="absolute right-2 top-2 flex items-center gap-1 rounded bg-black/60 px-2 py-1 text-xs text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
      onClick={() =>
        startFollowing(
          userId as Id<"users">,
          participant.name || "Participant",
        )
      }
      title={`Follow ${participant.name}`}
    >
      <Eye className="h-3 w-3" />
      Follow
    </button>
  );
}
