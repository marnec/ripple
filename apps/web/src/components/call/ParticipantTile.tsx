import { useEffect, useRef, type ReactNode } from "react";

import { VideoTile } from "@/pages/App/GroupVideoCall/VideoTile";

import type { CallParticipant } from "./types";

/**
 * Remote participant video tile. Children render as overlays on top of
 * the video (positioned absolutely by callers). Surfaces use this slot
 * to inject surface-specific affordances — e.g. the channel surface
 * passes a follow-mode button; the event surface passes nothing.
 *
 * The `group` class is added when an overlay is present so children can
 * use Tailwind's `group-hover:` modifier to fade in on hover.
 */
export function CallParticipantTile({
  participant,
  children,
}: {
  participant: CallParticipant;
  children?: ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    participant.registerVideoElement(el);
    return () => {
      participant.deregisterVideoElement(el);
    };
  }, [participant, participant.videoTrack]);

  return (
    <VideoTile.Root className={children ? "group" : undefined}>
      {participant.videoEnabled ? (
        <VideoTile.Video videoRef={videoRef} />
      ) : (
        <VideoTile.AvatarFallback name={participant.name} />
      )}
      <VideoTile.NameBadge
        name={participant.name || "Participant"}
        muted={!participant.audioEnabled}
      />
      {children}
    </VideoTile.Root>
  );
}
