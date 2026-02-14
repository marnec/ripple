import {
  RealtimeKitProvider,
  useRealtimeKitClient,
  useRealtimeKitMeeting,
  useRealtimeKitSelector,
} from "@cloudflare/realtimekit-react";
import { RtkParticipantsAudio } from "@cloudflare/realtimekit-react-ui";
import { useAction, useMutation, useQuery } from "convex/react";
import { LogOut, Monitor, MonitorOff } from "lucide-react";
import { MessageSquare } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Button } from "../../../components/ui/button";
import { Chat } from "../Chat/Chat";
import { CallLobby, type DevicePreferences } from "./CallLobby";
import { CameraToggle, MicToggle } from "./MediaToggle";
import { VideoTile } from "./VideoTile";

// --- Meeting room context ---

interface MeetingRoomContextValue {
  channelId: Id<"channels">;
  chatOpen: boolean;
  toggleChat: () => void;
  onLeave: () => void;
}

const MeetingRoomContext = createContext<MeetingRoomContextValue | null>(null);

function useMeetingRoom() {
  const ctx = useContext(MeetingRoomContext);
  if (!ctx)
    throw new Error("useMeetingRoom must be used within MeetingRoom");
  return ctx;
}

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
    <VideoTile.Root>
      {participant.videoEnabled ? (
        <VideoTile.Video videoRef={videoRef} />
      ) : (
        <VideoTile.AvatarFallback name={participant.name} />
      )}
      <VideoTile.NameBadge
        name={participant.name || "Participant"}
        muted={!participant.audioEnabled}
      />
    </VideoTile.Root>
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
    <VideoTile.Root>
      {videoEnabled ? (
        <VideoTile.Video videoRef={videoRef} mirrored />
      ) : (
        <VideoTile.AvatarFallback name={name || "You"} />
      )}
      <VideoTile.NameBadge
        name={`${name || "You"} (You)`}
        muted={!audioEnabled}
      />
    </VideoTile.Root>
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

function ControlsBar() {
  const { meeting } = useRealtimeKitMeeting();
  const { channelId, chatOpen, toggleChat, onLeave } = useMeetingRoom();
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
    const remaining = meeting.participants.joined.toArray();
    if (remaining.length === 0) {
      await endSession({ channelId });
    }
    onLeave();
  }, [meeting, channelId, endSession, onLeave]);

  return (
    <div className="flex items-center justify-center gap-3 border-t bg-background px-4 py-3 pb-[calc(0.75rem+var(--safe-area-bottom))]">
      <MicToggle
        enabled={audioEnabled}
        onToggle={() => void toggleAudio()}
      />
      <CameraToggle
        enabled={videoEnabled}
        onToggle={() => void toggleVideo()}
      />
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
        onClick={toggleChat}
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
    <MeetingRoomContext.Provider
      value={{
        channelId,
        chatOpen,
        toggleChat: () => setChatOpen((o) => !o),
        onLeave,
      }}
    >
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
        <ControlsBar />
      </div>
    </MeetingRoomContext.Provider>
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
    "lobby" | "joining" | "joined" | "error"
  >("lobby");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  // Cleanup: leave meeting on unmount (e.g. navigation away without clicking Leave)
  useEffect(() => {
    if (!meeting) return;
    return () => {
      void meeting.leave();
    };
  }, [meeting]);

  const handleLeave = useCallback(() => {
    void navigate(
      `/workspaces/${workspaceId}/channels/${channelId}`,
    );
  }, [navigate, workspaceId, channelId]);

  const handleJoin = useCallback(
    async (prefs: DevicePreferences) => {
      if (!user) return;
      try {
        setStatus("joining");

        const { authToken } = await joinCallAction({
          channelId,
          userName: user.name || "Anonymous",
          userImage: user.image ?? undefined,
        });

        const m = await initMeeting({
          authToken,
          defaults: {
            audio: prefs.audioEnabled,
            video: prefs.videoEnabled,
          },
        });

        if (m) {
          await m.join();

          // Apply device selections if specified
          if (prefs.audioDeviceId) {
            const audioDevices = await m.self.getAudioDevices();
            const selected = audioDevices.find(
              (d: { deviceId: string }) => d.deviceId === prefs.audioDeviceId,
            );
            if (selected) await m.self.setDevice(selected);
          }
          if (prefs.videoDeviceId) {
            const videoDevices = await m.self.getVideoDevices();
            const selected = videoDevices.find(
              (d: { deviceId: string }) => d.deviceId === prefs.videoDeviceId,
            );
            if (selected) await m.self.setDevice(selected);
          }

          setStatus("joined");
        }
      } catch (err) {
        console.error("Failed to join call:", err);
        setError(
          err instanceof Error ? err.message : "Failed to join call",
        );
        setStatus("error");
      }
    },
    [user, channelId, joinCallAction, initMeeting],
  );

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

  if (status === "lobby") {
    return (
      <CallLobby
        userName={user?.name || "You"}
        onJoin={(prefs) => void handleJoin(prefs)}
        onBack={handleLeave}
      />
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
