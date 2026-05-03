import { Mic, MicOff, Video, VideoOff } from "lucide-react";
import { Button } from "../../../components/ui/button";

export function MicToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant={enabled ? "secondary" : "destructive"}
      size="icon"
      className="h-11 w-11 md:h-9 md:w-9"
      onClick={onToggle}
      title={enabled ? "Mute" : "Unmute"}
    >
      {enabled ? (
        <Mic className="h-5 w-5" />
      ) : (
        <MicOff className="h-5 w-5" />
      )}
    </Button>
  );
}

export function CameraToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant={enabled ? "secondary" : "destructive"}
      size="icon"
      className="h-11 w-11 md:h-9 md:w-9"
      onClick={onToggle}
      title={enabled ? "Turn off camera" : "Turn on camera"}
    >
      {enabled ? (
        <Video className="h-5 w-5" />
      ) : (
        <VideoOff className="h-5 w-5" />
      )}
    </Button>
  );
}
