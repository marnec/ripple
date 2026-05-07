import {
  useRealtimeKitMeeting,
  useRealtimeKitSelector,
} from "@cloudflare/realtimekit-react";
import { LogOut, Monitor, MonitorOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useActiveCall } from "@/contexts/ActiveCallContext";
import { CameraToggle, MicToggle } from "@/pages/App/GroupVideoCall/MediaToggle";

/**
 * Controls strip for the joined meeting: mic, camera, screen share, leave.
 * Screen-share state is local to the RTK meeting; mic/cam toggles read
 * from the live meeting selectors. Leave delegates to the active-call
 * context so navigation + cleanup happen in one place.
 */
export function CallControlsBar() {
  const { meeting } = useRealtimeKitMeeting();
  const { leaveCall } = useActiveCall();

  const audioEnabled = useRealtimeKitSelector((m) => m.self.audioEnabled);
  const videoEnabled = useRealtimeKitSelector((m) => m.self.videoEnabled);
  const screenShareEnabled = useRealtimeKitSelector(
    (m) => m.self.screenShareEnabled,
  );

  const toggleAudio = async () => {
    if (audioEnabled) await meeting.self.disableAudio();
    else await meeting.self.enableAudio();
  };
  const toggleVideo = async () => {
    if (videoEnabled) await meeting.self.disableVideo();
    else await meeting.self.enableVideo();
  };
  const toggleScreenShare = async () => {
    if (screenShareEnabled) await meeting.self.disableScreenShare();
    else await meeting.self.enableScreenShare();
  };

  return (
    <div className="flex items-center justify-center gap-3 border-t bg-background px-4 py-3 pb-[calc(0.75rem+var(--safe-area-bottom))]">
      <MicToggle enabled={audioEnabled} onToggle={() => void toggleAudio()} />
      <CameraToggle enabled={videoEnabled} onToggle={() => void toggleVideo()} />
      <Button
        variant={screenShareEnabled ? "destructive" : "secondary"}
        size="icon"
        className="h-11 w-11 md:h-9 md:w-9"
        onClick={() => void toggleScreenShare()}
        title={screenShareEnabled ? "Stop sharing" : "Share screen"}
      >
        {screenShareEnabled ? (
          <MonitorOff className="h-5 w-5" />
        ) : (
          <Monitor className="h-5 w-5" />
        )}
      </Button>
      <Button
        variant="destructive"
        onClick={() => void leaveCall()}
        className="gap-2 h-11 md:h-9"
      >
        <LogOut className="h-4 w-4" />
        Leave
      </Button>
    </div>
  );
}
