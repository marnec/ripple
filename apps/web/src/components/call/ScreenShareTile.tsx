import { useEffect, useRef } from "react";

/**
 * One shared screen on the meeting stage. The SDK hands us a bare
 * `MediaStreamTrack` for screen share (unlike camera video, which has
 * `registerVideoElement`), so we wrap it in a `MediaStream` ourselves.
 *
 * `object-contain` on purpose: a shared screen is content, not a face, and
 * cropping its edges to fill the tile would hide exactly the parts people
 * point at. The letterbox is the honest shape.
 *
 * Always muted — share audio (when the sharer picked a tab with audio) is
 * mixed by `RtkParticipantsAudio` alongside the mic tracks, and the sharer
 * must never hear their own share back.
 */
export function CallScreenShareTile({
  track,
  name,
  isSelf,
}: {
  track: MediaStreamTrack | null | undefined;
  name: string;
  isSelf?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = track ? new MediaStream([track]) : null;
    return () => {
      el.srcObject = null;
    };
  }, [track]);

  return (
    <div className="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden rounded-lg bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="h-full w-full object-contain"
      />
      <div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs text-white">
        {isSelf ? "You are presenting" : `${name || "Participant"} is presenting`}
      </div>
    </div>
  );
}
