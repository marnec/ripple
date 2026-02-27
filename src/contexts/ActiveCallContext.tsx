import type RTKClient from "@cloudflare/realtimekit";
import { useRealtimeKitClient } from "@cloudflare/realtimekit-react";
import { RtkParticipantsAudio } from "@cloudflare/realtimekit-react-ui";
import { useAction, useMutation } from "convex/react";
import { makeFunctionReference } from "convex/server";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Id } from "../../convex/_generated/dataModel";

const joinCallRef = makeFunctionReference<
  "action",
  { channelId: Id<"channels">; userName: string; userImage?: string },
  { authToken: string; meetingId: string }
>("callSessions:joinCall");

const endSessionRef = makeFunctionReference<
  "mutation",
  { channelId: Id<"channels"> },
  null
>("callSessions:endSession");
import type { DevicePreferences } from "../pages/App/GroupVideoCall/CallLobby";

type CallStatus = "idle" | "lobby" | "joining" | "joined" | "error";

interface ActiveCallContextValue {
  meeting: RTKClient | null;
  channelId: Id<"channels"> | null;
  workspaceId: Id<"workspaces"> | null;
  status: CallStatus;
  error: string | null;
  isFloating: boolean;
  enterLobby: (channelId: Id<"channels">, workspaceId: Id<"workspaces">) => void;
  joinCall: (prefs: DevicePreferences) => Promise<void>;
  leaveCall: () => Promise<void>;
  returnToCall: () => void;
}

const ActiveCallContext = createContext<ActiveCallContextValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useActiveCall() {
  const ctx = useContext(ActiveCallContext);
  if (!ctx)
    throw new Error("useActiveCall must be used within ActiveCallProvider");
  return ctx;
}

export function ActiveCallProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [meeting, initMeeting] = useRealtimeKitClient();
  const [channelId, setChannelId] = useState<Id<"channels"> | null>(null);
  const [workspaceId, setWorkspaceId] = useState<Id<"workspaces"> | null>(null);
  const [status, setStatus] = useState<CallStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const joinCallAction = useAction(joinCallRef);
  const endSession = useMutation(endSessionRef);
  const navigate = useNavigate();
  const location = useLocation();

  // Determine if the call is floating (user navigated away from the call route)
  const isFloating =
    status === "joined" &&
    meeting !== null &&
    channelId !== null &&
    !location.pathname.endsWith("/videocall");

  // Stable refs for cleanup
  const meetingRef = useRef(meeting);
  const channelIdRef = useRef(channelId);
  useEffect(() => {
    meetingRef.current = meeting;
    channelIdRef.current = channelId;
  }, [meeting, channelId]);

  const enterLobby = useCallback(
    (cId: Id<"channels">, wId: Id<"workspaces">) => {
      // Only enter lobby if we're not already in a call for this channel
      if (status === "joined" && channelId === cId) return;
      setChannelId(cId);
      setWorkspaceId(wId);
      setStatus("lobby");
      setError(null);
    },
    [status, channelId],
  );

  const joinCall = useCallback(
    async (prefs: DevicePreferences) => {
      if (!channelId) return;
      try {
        setStatus("joining");

        const { authToken } = await joinCallAction({
          channelId,
          userName: prefs.userName ?? "Anonymous",
          userImage: prefs.userImage,
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
    [channelId, joinCallAction, initMeeting],
  );

  const leaveCall = useCallback(async () => {
    const m = meetingRef.current;
    const cId = channelIdRef.current;
    if (m) {
      await m.leave();
      const remaining = m.participants.joined.toArray();
      if (remaining.length === 0 && cId) {
        await endSession({ channelId: cId });
      }
    }
    // Navigate back to the channel (if we have the info)
    if (workspaceId && channelId) {
      void navigate(
        `/workspaces/${workspaceId}/channels/${channelId}`,
      );
    }
    setStatus("idle");
    setChannelId(null);
    setWorkspaceId(null);
    setError(null);
  }, [endSession, navigate, workspaceId, channelId]);

  const returnToCall = useCallback(() => {
    if (workspaceId && channelId) {
      void navigate(
        `/workspaces/${workspaceId}/channels/${channelId}/videocall`,
      );
    }
  }, [navigate, workspaceId, channelId]);

  // Cleanup on provider unmount (tab close, logout)
  useEffect(() => {
    return () => {
      const m = meetingRef.current;
      if (m) {
        void m.leave();
      }
    };
  }, []);

  return (
    <ActiveCallContext.Provider
      value={{
        meeting,
        channelId,
        workspaceId,
        status,
        error,
        isFloating,
        enterLobby,
        joinCall,
        leaveCall,
        returnToCall,
      }}
    >
      {/* Audio always plays regardless of which view is active */}
      {meeting && status === "joined" && (
        <RtkParticipantsAudio meeting={meeting} />
      )}
      {children}
    </ActiveCallContext.Provider>
  );
}
