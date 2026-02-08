import {
  RealtimeKitProvider,
  useRealtimeKitClient,
  useRealtimeKitMeeting,
  useRealtimeKitSelector,
} from "@cloudflare/realtimekit-react";
import { RtkParticipantsAudio } from "@cloudflare/realtimekit-react-ui";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  LogOut,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  Video,
  VideoOff,
} from "lucide-react";
import { MessageSquare } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Button } from "../../../components/ui/button";
import { Chat } from "../Chat/Chat";

// --- Participant video tile ---

function ParticipantTile({
  participant,
}: {
  participant: {
    id: string;
    name: string;
    picture: string;
    videoEnabled: boolean;
    audioEnabled: boolean;
    videoTrack: MediaStreamTrack;
    registerVideoElement: (el: HTMLVideoElement) => void;
    deregisterVideoElement: (el?: HTMLVideoElement) => void;
  };
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
    <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-muted">
      {participant.videoEnabled ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl font-semibold text-primary-foreground">
            {participant.name?.charAt(0).toUpperCase() || "?"}
          </div>
          <span className="text-sm text-muted-foreground">
            {participant.name || "Participant"}
          </span>
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded bg-black/60 px-2 py-1 text-xs text-white">
        {!participant.audioEnabled && <MicOff className="h-3 w-3" />}
        <span>{participant.name || "Participant"}</span>
      </div>
    </div>
  );
}

// --- Self video tile ---

function SelfTile() {
  const { meeting } = useRealtimeKitMeeting();
  const videoEnabled = useRealtimeKitSelector(
    (m) => m.self.videoEnabled,
  );
  const videoTrack = useRealtimeKitSelector(
    (m) => m.self.videoTrack,
  );
  const audioEnabled = useRealtimeKitSelector(
    (m) => m.self.audioEnabled,
  );
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
    <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-muted">
      {videoEnabled ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full -scale-x-100 object-cover"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl font-semibold text-primary-foreground">
            {name?.charAt(0).toUpperCase() || "?"}
          </div>
          <span className="text-sm text-muted-foreground">
            {name || "You"}
          </span>
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded bg-black/60 px-2 py-1 text-xs text-white">
        {!audioEnabled && <MicOff className="h-3 w-3" />}
        <span>{name || "You"} (You)</span>
      </div>
    </div>
  );
}

// --- Video grid ---

function VideoGrid() {
  const participants = useRealtimeKitSelector((m) =>
    m.participants.joined.toArray(),
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
      <SelfTile />
      {participants.map((p) => (
        <ParticipantTile key={p.id} participant={p} />
      ))}
    </div>
  );
}

// --- Controls bar ---

function ControlsBar({
  channelId,
  onLeave,
  chatOpen,
  onToggleChat,
}: {
  channelId: Id<"channels">;
  onLeave: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
}) {
  const { meeting } = useRealtimeKitMeeting();
  const audioEnabled = useRealtimeKitSelector(
    (m) => m.self.audioEnabled,
  );
  const videoEnabled = useRealtimeKitSelector(
    (m) => m.self.videoEnabled,
  );
  const screenShareEnabled = useRealtimeKitSelector(
    (m) => m.self.screenShareEnabled,
  );
  const endSession = useMutation(api.callSessions.endSession);

  const toggleAudio = useCallback(async () => {
    if (audioEnabled) {
      await meeting.self.disableAudio();
    } else {
      await meeting.self.enableAudio();
    }
  }, [meeting.self, audioEnabled]);

  const toggleVideo = useCallback(async () => {
    if (videoEnabled) {
      await meeting.self.disableVideo();
    } else {
      await meeting.self.enableVideo();
    }
  }, [meeting.self, videoEnabled]);

  const toggleScreenShare = useCallback(async () => {
    if (screenShareEnabled) {
      await meeting.self.disableScreenShare();
    } else {
      await meeting.self.enableScreenShare();
    }
  }, [meeting.self, screenShareEnabled]);

  const handleLeave = useCallback(async () => {
    await meeting.leave();
    // Check if any other participants remain
    const remaining = meeting.participants.joined.toArray();
    if (remaining.length === 0) {
      await endSession({ channelId });
    }
    onLeave();
  }, [meeting, channelId, endSession, onLeave]);

  return (
    <div className="flex items-center justify-center gap-3 border-t bg-background px-4 py-3 pb-[calc(0.75rem+var(--safe-area-bottom))]">
      <Button
        variant={audioEnabled ? "secondary" : "destructive"}
        size="icon"
        className="h-11 w-11 md:h-9 md:w-9"
        onClick={() => void toggleAudio()}
        title={audioEnabled ? "Mute" : "Unmute"}
      >
        {audioEnabled ? (
          <Mic className="h-5 w-5" />
        ) : (
          <MicOff className="h-5 w-5" />
        )}
      </Button>
      <Button
        variant={videoEnabled ? "secondary" : "destructive"}
        size="icon"
        className="h-11 w-11 md:h-9 md:w-9"
        onClick={() => void toggleVideo()}
        title={videoEnabled ? "Turn off camera" : "Turn on camera"}
      >
        {videoEnabled ? (
          <Video className="h-5 w-5" />
        ) : (
          <VideoOff className="h-5 w-5" />
        )}
      </Button>
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
        variant={chatOpen ? "default" : "secondary"}
        size="icon"
        className="h-11 w-11 md:h-9 md:w-9"
        onClick={onToggleChat}
        title={chatOpen ? "Close chat" : "Open chat"}
      >
        <MessageSquare className="h-5 w-5" />
      </Button>
      <Button
        variant="destructive"
        onClick={() => void handleLeave()}
        className="gap-2 h-11 md:h-9"
      >
        <LogOut className="h-4 w-4" />
        Leave
      </Button>
    </div>
  );
}

// --- Meeting room (once joined) ---

function MeetingRoom({
  channelId,
  onLeave,
}: {
  channelId: Id<"channels">;
  onLeave: () => void;
}) {
  const { meeting } = useRealtimeKitMeeting();
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <RtkParticipantsAudio meeting={meeting} />
      <div className="flex min-h-0 flex-1">
        {/* Video grid */}
        <div className="flex flex-1 flex-col overflow-y-auto p-4">
          <VideoGrid />
        </div>
        {/* Chat sidebar — intentionally desktop-only (lg+). On mobile/tablet the
           video grid takes full width; chat is accessible from the channel after leaving. */}
        {chatOpen && (
          <div className="hidden w-80 border-l lg:flex lg:flex-col lg:overflow-hidden">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-sm font-medium">Chat</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setChatOpen(false)}
                title="Close chat"
              >
                <MessageSquare className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <Chat channelId={channelId} variant="compact" />
            </div>
          </div>
        )}
      </div>
      <ControlsBar
        channelId={channelId}
        onLeave={onLeave}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen((o) => !o)}
      />
    </div>
  );
}

// --- Main component ---

const GroupVideoCall = ({
  channelId,
  workspaceId,
}: {
  channelId: Id<"channels">;
  workspaceId: Id<"workspaces">;
}) => {
  const user = useQuery(api.users.viewer);
  const joinCallAction = useAction(api.callSessions.joinCall);
  const [meeting, initMeeting] = useRealtimeKitClient();
  const [status, setStatus] = useState<
    "idle" | "joining" | "joined" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const initRef = useRef(false);

  // Initialize meeting on mount
  useEffect(() => {
    if (!user || initRef.current) return;
    initRef.current = true;

    const init = async () => {
      try {
        setStatus("joining");

        // Get auth token from Convex action
        const { authToken } = await joinCallAction({
          channelId,
          userName: user.name || "Anonymous",
          userImage: user.image ?? undefined,
        });

        // Initialize the RealtimeKit client
        const m = await initMeeting({
          authToken,
          defaults: { audio: false, video: false },
        });

        if (m) {
          await m.join();
          setStatus("joined");
        }
      } catch (err) {
        console.error("Failed to join call:", err);
        setError(
          err instanceof Error ? err.message : "Failed to join call",
        );
        setStatus("error");
      }
    };

    void init();
  }, [user, channelId, joinCallAction, initMeeting]);

  const handleLeave = useCallback(() => {
    void navigate(
      `/workspaces/${workspaceId}/channels/${channelId}`,
    );
  }, [navigate, workspaceId, channelId]);

  if (status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-destructive">{error}</p>
        <Button variant="outline" onClick={handleLeave}>
          Back to channel
        </Button>
      </div>
    );
  }

  if (status !== "joined" || !meeting) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Joining call...</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden">
      <RealtimeKitProvider value={meeting}>
        <MeetingRoom channelId={channelId} onLeave={handleLeave} />
      </RealtimeKitProvider>
    </div>
  );
};

export default GroupVideoCall;
