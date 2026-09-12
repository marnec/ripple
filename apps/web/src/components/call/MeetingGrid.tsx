import { useRealtimeKitSelector } from "@cloudflare/realtimekit-react";
import { type ReactNode } from "react";

import { CallParticipantTile } from "./ParticipantTile";
import { CallScreenShareTile } from "./ScreenShareTile";
import { CallSelfTile } from "./SelfTile";
import type { CallParticipant } from "./types";

/**
 * Video layout for the joined meeting: self tile + every joined remote
 * participant.
 *
 * Two shapes. With nobody sharing, an auto-sized camera grid (the
 * breakpoint logic mirrors the prior inline implementation). While
 * someone is sharing a screen, the share takes the stage and the camera
 * tiles shrink into a scrollable strip underneath — a shared screen is
 * what the call is about at that moment, and a camera grid that keeps its
 * size would leave the share the same tile size as a face.
 *
 * The sharer sees their own share on the stage too, so what the others
 * are looking at is never a guess. Presets cap concurrent shares at 1–3;
 * more than one share splits the stage rather than picking a winner.
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
  const selfSharing = useRealtimeKitSelector((m) => m.self.screenShareEnabled);
  const selfShareTrack = useRealtimeKitSelector(
    (m) => m.self.screenShareTracks?.video,
  );
  const selfName = useRealtimeKitSelector((m) => m.self.name);

  const shares: { key: string; name: string; track: MediaStreamTrack | undefined; isSelf: boolean }[] = [
    ...(selfSharing
      ? [{ key: "self", name: selfName, track: selfShareTrack, isSelf: true }]
      : []),
    ...participants
      .filter((p) => p.screenShareEnabled)
      .map((p) => ({
        key: p.id,
        name: p.name,
        track: p.screenShareTracks?.video,
        isSelf: false,
      })),
  ];

  const cameraTiles = (
    <>
      <CallSelfTile />
      {participants.map((p) => (
        <CallParticipantTile key={p.id} participant={p}>
          {renderParticipantOverlay?.(p)}
        </CallParticipantTile>
      ))}
    </>
  );

  if (shares.length > 0) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3" data-layout="stage">
        <div
          className={`grid min-h-0 flex-1 gap-3 ${
            shares.length === 1 ? "grid-cols-1" : "grid-cols-2"
          }`}
        >
          {shares.map((s) => (
            <CallScreenShareTile
              key={s.key}
              track={s.track}
              name={s.name}
              isSelf={s.isSelf}
            />
          ))}
        </div>
        <div className="flex shrink-0 gap-3 overflow-x-auto pb-1 [&>*]:w-36 [&>*]:shrink-0 sm:[&>*]:w-44">
          {cameraTiles}
        </div>
      </div>
    );
  }

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
      data-layout="grid"
    >
      {cameraTiles}
    </div>
  );
}
