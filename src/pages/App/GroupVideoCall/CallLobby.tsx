import { ArrowLeft, Phone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { useAudioLevel } from "../../../hooks/use-audio-level";
import { useMediaDevices } from "../../../hooks/use-media-devices";
import { useUserMedia } from "../../../hooks/use-user-media";
import { CameraToggle, MicToggle } from "./MediaToggle";
import { VideoPreview } from "./VideoPreview";

const STORAGE_KEY = "ripple:device-preferences";

export interface DevicePreferences {
  audioEnabled: boolean;
  videoEnabled: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
  audioOutputDeviceId?: string;
  userName?: string;
  userImage?: string;
}

function loadPreferences(): DevicePreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as DevicePreferences;
  } catch {
    // ignore
  }
  return { audioEnabled: true, videoEnabled: true };
}

function savePreferences(prefs: DevicePreferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export function CallLobby({
  userName,
  onJoin,
  onBack,
}: {
  userName: string;
  onJoin: (prefs: DevicePreferences) => void;
  onBack: () => void;
}) {
  const [prefs, setPrefs] = useState<DevicePreferences>(loadPreferences);

  const { audioInputs, videoInputs, audioOutputs, refresh } =
    useMediaDevices();

  const { stream, error: mediaError } = useUserMedia({
    audio: prefs.audioEnabled,
    video: prefs.videoEnabled,
    audioDeviceId: prefs.audioDeviceId,
    videoDeviceId: prefs.videoDeviceId,
  });

  // Re-enumerate devices after getUserMedia grants permission
  useEffect(() => {
    if (stream) void refresh();
  }, [stream, refresh]);

  const audioLevel = useAudioLevel(stream);

  const updatePrefs = useCallback((partial: Partial<DevicePreferences>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...partial };
      savePreferences(next);
      return next;
    });
  }, []);

  return (
    <div className="flex h-full w-full items-center justify-center overflow-y-auto p-4">
      <div className="flex w-full max-w-3xl flex-col gap-5 rounded-xl border bg-card p-5 shadow-lg sm:p-6">
        <h2 className="text-center text-lg font-semibold">Ready to join?</h2>

        {/* Two-column on md+: preview left, settings right */}
        <div className="flex flex-col gap-5 md:flex-row md:gap-6">
          {/* Left: video preview + audio level + toggles */}
          <div className="flex flex-1 flex-col gap-3">
            <VideoPreview
              stream={stream}
              videoEnabled={prefs.videoEnabled}
              userName={userName}
            />

            {/* Audio level bar */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-green-500 transition-all duration-75"
                style={{ width: `${Math.min(audioLevel * 100 * 3, 100)}%` }}
              />
            </div>

            {/* Media error */}
            {mediaError && (
              <p className="text-center text-sm text-destructive">
                {mediaError}
              </p>
            )}

            {/* Toggle buttons */}
            <div className="flex items-center justify-center gap-3">
              <MicToggle
                enabled={prefs.audioEnabled}
                onToggle={() =>
                  updatePrefs({ audioEnabled: !prefs.audioEnabled })
                }
              />
              <CameraToggle
                enabled={prefs.videoEnabled}
                onToggle={() =>
                  updatePrefs({ videoEnabled: !prefs.videoEnabled })
                }
              />
            </div>
          </div>

          {/* Right: device selectors */}
          <div className="flex flex-col gap-3 md:w-56 md:justify-center">
            {/* Microphone */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">
                Microphone
              </label>
              <Select
                value={prefs.audioDeviceId ?? ""}
                onValueChange={(v) =>
                  updatePrefs({ audioDeviceId: v || undefined })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Default microphone" />
                </SelectTrigger>
                <SelectContent>
                  {audioInputs
                    .filter((d) => d.deviceId)
                    .map((d) => (
                      <SelectItem key={d.deviceId} value={d.deviceId}>
                        {d.label || `Microphone ${d.deviceId.slice(0, 5)}`}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Camera */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">
                Camera
              </label>
              <Select
                value={prefs.videoDeviceId ?? ""}
                onValueChange={(v) =>
                  updatePrefs({ videoDeviceId: v || undefined })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Default camera" />
                </SelectTrigger>
                <SelectContent>
                  {videoInputs
                    .filter((d) => d.deviceId)
                    .map((d) => (
                      <SelectItem key={d.deviceId} value={d.deviceId}>
                        {d.label || `Camera ${d.deviceId.slice(0, 5)}`}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Speaker */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">
                Speaker
              </label>
              <Select
                value={prefs.audioOutputDeviceId ?? ""}
                onValueChange={(v) =>
                  updatePrefs({ audioOutputDeviceId: v || undefined })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Default speaker" />
                </SelectTrigger>
                <SelectContent>
                  {audioOutputs
                    .filter((d) => d.deviceId)
                    .map((d) => (
                      <SelectItem key={d.deviceId} value={d.deviceId}>
                        {d.label || `Speaker ${d.deviceId.slice(0, 5)}`}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-between gap-3 border-t pt-4">
          <Button variant="ghost" onClick={onBack} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <Button onClick={() => onJoin(prefs)} className="gap-2">
            <Phone className="h-4 w-4" />
            Join Call
          </Button>
        </div>
      </div>
    </div>
  );
}
