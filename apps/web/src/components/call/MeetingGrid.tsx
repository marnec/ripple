import { useRealtimeKitSelector } from "@cloudflare/realtimekit-react";
import { type ReactNode } from "react";

import { CallParticipantTile } from "./ParticipantTile";
import { CallSelfTile } from "./SelfTile";
import type { CallParticipant } from "./types";

/**
 * Auto-sized video grid: self tile + every joined remote participant.
 * The grid breakpoint logic mirrors the prior inline implementation.
 *
 * `renderParticipantOverlay` is the slot for surface-specific tile
 * decorations — channel calls pass a follow-button overlay; event calls
 * leave it undefined and render plain tiles.
 */
export function CallMeetingGrid({
  renderParticipantOverlay,
}: {
  renderParticipantOverlay?: (participant: CallParticipant) => ReactNode;
}) {
  const participants = useRealtimeKitSelector(
    (m) => m.participants.joined.toArray() as CallParticipant[],
  );

  return (
    <div
      className={`grid gap-3 ${
        participants.length === 0
          ? "grid-cols-1"
          : participants.length <= 1
            ? "grid-cols-1 sm:grid-cols-2"
            : participants.length <= 3
              ? "grid-cols-2"
              : "grid-cols-2 lg:grid-cols-3"
      }`}
    >
      <CallSelfTile />
      {participants.map((p) => (
        <CallParticipantTile key={p.id} participant={p}>
          {renderParticipantOverlay?.(p)}
        </CallParticipantTile>
      ))}
    </div>
  );
}
