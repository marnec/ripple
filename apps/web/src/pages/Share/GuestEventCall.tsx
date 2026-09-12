import {
  RealtimeKitProvider,
  useRealtimeKitClient,
  useRealtimeKitMeeting,
  useRealtimeKitSelector,
} from "@cloudflare/realtimekit-react";
import { RtkParticipantsAudio } from "@cloudflare/realtimekit-react-ui";
import { useAction } from "convex/react";
import { LogOut, Monitor, MonitorOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "@convex/_generated/api";
import { Button } from "@ripple/ui/components/button";
import { RippleSpinner } from "@/components/RippleSpinner";
import { CallMeetingGrid } from "@/components/call/MeetingGrid";
import { TranscriptionPill } from "@/components/call/GuestTranscriptionNotice";
import { CameraToggle, MicToggle } from "@/pages/App/GroupVideoCall/MediaToggle";

interface Props {
  shareId: string;
  guestSub: string;
  guestName: string;
  onLeave: () => void;
}

/**
 * Guest call surface for a calendar event share. Mirrors GuestCallView.tsx
 * structure but obtains the participant token via
 * `api.calendarEvents.getGuestEventCallToken` (which validates the join
 * window and the event's resource type) instead of the channel-only
 * `api.shares.getGuestCallToken`.
 *
 * Kept deliberately separate so changes to the channel guest-call flow
 * don't accidentally relax the event-level checks.
 */
export function GuestEventCall({ shareId, guestSub, guestName, onLeave }: Props) {
  const getToken = useAction(api.calendarEvents.getGuestEventCallToken);
  const [meeting, initMeeting] = useRealtimeKitClient();
  const [status, setStatus] = useState<"joining" | "joined" | "error" | "left">(
    "joining",
  );
  const [error, setError] = useState<string | null>(null);
  // Authoritative for this meeting, resolved server-side by the token action.
  const [transcribe, setTranscribe] = useState(false);
  const meetingRef = useRef(meeting);

  useEffect(() => {
    meetingRef.current = meeting;
  }, [meeting]);

  const bootstrappedRef = useRef(false);
  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    let cancelled = false;

    void (async () => {
      try {
        const { authToken, transcribe: isTranscribed } = await getToken({
          shareId,
          guestSub,
          guestName,
        });
        if (cancelled) return;
        setTranscribe(isTranscribed);
        const m = await initMeeting({
          authToken,
          defaults: { audio: false, video: false },
        });
        if (cancelled) return;
        if (m) {
          await m.join();
          if (cancelled) return;
          setStatus("joined");
        }
      } catch (err) {
        console.error("Failed to join event call:", err);
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to join call");
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getToken, initMeeting, shareId, guestSub, guestName]);

  // Leave the meeting if the component unmounts.
  useEffect(() => {
    return () => {
      const m = meetingRef.current;
      if (m) void m.leave();
    };
  }, []);

  if (status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-destructive">{error ?? "Something went wrong"}</p>
        <Button variant="outline" onClick={onLeave}>Back</Button>
      </div>
    );
  }

  if (status === "left") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-xl font-semibold">You left the call</h1>
        <Button variant="outline" onClick={onLeave}>Back to invitation</Button>
      </div>
    );
  }

  if (!meeting || status !== "joined") {
    return (
      <div className="flex h-full items-center justify-center">
        <RippleSpinner size={64} />
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden">
      <RealtimeKitProvider value={meeting}>
        <RtkParticipantsAudio meeting={meeting} />
        <GuestMeetingRoom
          transcribe={transcribe}
          onLeave={() => setStatus("left")}
        />
      </RealtimeKitProvider>
    </div>
  );
}

// ── Same room/controls helpers as GuestCallView (intentionally duplicated; the
//    two surfaces are likely to diverge as event-specific affordances land).

function GuestMeetingRoom({
  transcribe,
  onLeave,
}: {
  transcribe: boolean;
  onLeave: () => void;
}) {
  const { meeting } = useRealtimeKitMeeting();

  const handleLeave = async () => {
    await meeting.leave();
    onLeave();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        <CallMeetingGrid />
      </div>
      <GuestControlsBar
        transcribe={transcribe}
        onLeave={() => void handleLeave()}
      />
    </div>
  );
}

function GuestControlsBar({
  transcribe,
  onLeave,
}: {
  transcribe: boolean;
  onLeave: () => void;
}) {
  const { meeting } = useRealtimeKitMeeting();
  const audioEnabled = useRealtimeKitSelector((m) => m.self.audioEnabled);
  const videoEnabled = useRealtimeKitSelector((m) => m.self.videoEnabled);
  const screenShareEnabled = useRealtimeKitSelector((m) => m.self.screenShareEnabled);

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
      <TranscriptionPill transcribe={transcribe} />
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
      <Button variant="destructive" onClick={onLeave} className="gap-2 h-11 md:h-9">
        <LogOut className="h-4 w-4" />
        Leave
      </Button>
    </div>
  );
}
