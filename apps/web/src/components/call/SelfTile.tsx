import {
  useRealtimeKitMeeting,
  useRealtimeKitSelector,
} from "@cloudflare/realtimekit-react";
import { useEffect, useRef } from "react";

import { VideoTile } from "@/pages/App/GroupVideoCall/VideoTile";

/**
 * Self-video tile shown in the meeting grid. Reads from the surrounding
 * `RealtimeKitProvider` — must be rendered inside `<CallStage>` (which
 * provides the meeting context) or any other RTK provider.
 */
export function CallSelfTile() {
  const { meeting } = useRealtimeKitMeeting();
  const videoEnabled = useRealtimeKitSelector((m) => m.self.videoEnabled);
  const videoTrack = useRealtimeKitSelector((m) => m.self.videoTrack);
  const audioEnabled = useRealtimeKitSelector((m) => m.self.audioEnabled);
  const name = useRealtimeKitSelector((m) => m.self.name);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    meeting.self.registerVideoElement(el, true);
    return () => {
      meeting.self.deregisterVideoElement(el, true);
    };
  }, [meeting.self, videoTrack]);

  return (
    <VideoTile.Root>
      {videoEnabled ? (
        <VideoTile.Video videoRef={videoRef} mirrored />
      ) : (
        <VideoTile.AvatarFallback name={name || "You"} />
      )}
      <VideoTile.NameBadge name={`${name || "You"} (You)`} muted={!audioEnabled} />
    </VideoTile.Root>
  );
}
