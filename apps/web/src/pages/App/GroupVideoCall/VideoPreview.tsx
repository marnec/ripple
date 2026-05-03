import { useEffect, useRef } from "react";
import { VideoTile } from "./VideoTile";

export function VideoPreview({
  stream,
  videoEnabled,
  userName,
}: {
  stream: MediaStream | null;
  videoEnabled: boolean;
  userName: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = videoEnabled && stream ? stream : null;
  }, [stream, videoEnabled]);

  return (
    <VideoTile.Root className="w-full">
      {videoEnabled && stream ? (
        <VideoTile.Video videoRef={videoRef} mirrored />
      ) : (
        <VideoTile.AvatarFallback name={userName} />
      )}
    </VideoTile.Root>
  );
}
