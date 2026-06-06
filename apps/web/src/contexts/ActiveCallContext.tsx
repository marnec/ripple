import type RTKClient from "@cloudflare/realtimekit";
import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";

import type { DevicePreferences } from "../pages/App/GroupVideoCall/CallLobby";
import { useCallSession } from "../lib/call/use-call-session";
import type {
  CallSourceDescriptor,
  CallSourcePort,
} from "../lib/call/source-port";

// Lazy-loaded so the ~1.48 MB realtimekit-ui bundle is fetched only when a
// call is actually joined, not on every page load.
const LazyRtkParticipantsAudio = lazy(() =>
  import("@cloudflare/realtimekit-react-ui").then((m) => ({
    default: m.RtkParticipantsAudio,
  })),
);

type CallStatus = "idle" | "lobby" | "joining" | "joined" | "error";

interface ActiveCallContextValue {
  meeting: RTKClient | null;
  /**
   * The active source's descriptor, or `null` when no call is active.
   * Carries the polymorphic identity (channel/event), the resource id,
   * and the navigation paths. Consumers that care about kind read
   * `descriptor.kind` and branch from there.
   */
  descriptor: CallSourceDescriptor | null;
  status: CallStatus;
  error: string | null;
  isFloating: boolean;
  isPipDismissed: boolean;
  dismissPip: () => void;
  enterLobby: (port: CallSourcePort) => void;
  joinCall: (prefs: DevicePreferences) => Promise<void>;
  leaveCall: () => Promise<void>;
  /**
   * Leave the current call and immediately enter the lobby for `next`,
   * staying on the current URL. Used by `CallBusyScreen` so the user can
   * "leave that and join this" without an intermediate navigation hop.
   * Differs from `leaveCall` in that it does NOT navigate to the leaving
   * call's `leaveDestination` — the user is already on the new call's
   * route by the time this is called.
   */
  switchCall: (next: CallSourcePort) => Promise<void>;
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
  const session = useCallSession();
  const navigate = useNavigate();
  const location = useLocation();

  const [isPipDismissed, setIsPipDismissed] = useState(false);

  // The reducer surfaces `leaving` as its own phase to express
  // mid-leave-in-flight. Public consumers don't differentiate — they
  // see "still joined-ish" until the navigation lands.
  const publicStatus: CallStatus =
    session.state.status === "leaving" ? "idle" : session.state.status;

  // PiP visibility: joined + the user has navigated away from the
  // call's home page. `homePath` lives on the descriptor, so this
  // works for any source kind without code changes here.
  const isFloating =
    publicStatus === "joined" &&
    session.meeting !== null &&
    session.source !== null &&
    location.pathname !== session.source.descriptor.homePath;

  // Reset pip-dismissed when the user returns to the call page so the
  // window shows up next time they navigate away. Adjusted during render
  // (not in an effect) to avoid a cascading-render cycle.
  const [prevIsFloating, setPrevIsFloating] = useState(isFloating);
  if (prevIsFloating !== isFloating) {
    setPrevIsFloating(isFloating);
    if (!isFloating) setIsPipDismissed(false);
  }

  const joinCall = async (prefs: DevicePreferences): Promise<void> => {
    await session.joinCall({
      audioEnabled: prefs.audioEnabled,
      videoEnabled: prefs.videoEnabled,
      audioDeviceId: prefs.audioDeviceId,
      videoDeviceId: prefs.videoDeviceId,
      audioOutputDeviceId: prefs.audioOutputDeviceId,
      userName: prefs.userName ?? "Anonymous",
      userImage: prefs.userImage,
      transcribe: prefs.transcribe,
    });
  };

  const leaveCall = async (): Promise<void> => {
    // Capture the leave destination before `session.leaveCall()` clears
    // the source — otherwise we lose the route to navigate to.
    const dest = session.source?.descriptor.leaveDestination ?? null;
    await session.leaveCall();
    if (dest) void navigate(dest);
  };

  const switchCall = async (next: CallSourcePort): Promise<void> => {
    // No navigation — the caller is already on the new call's URL. We
    // tear down the active session, then drop into the lobby for the
    // requested source. The route's render branch will pick up the new
    // descriptor and stop showing the busy screen.
    await session.leaveCall();
    session.enterLobby(next);
  };

  const returnToCall = (): void => {
    const home = session.source?.descriptor.homePath;
    if (home) void navigate(home);
  };

  return (
    <ActiveCallContext.Provider
      value={{
        meeting: session.meeting,
        descriptor: session.source?.descriptor ?? null,
        status: publicStatus,
        error: session.state.error?.message ?? null,
        isFloating,
        isPipDismissed,
        dismissPip: () => setIsPipDismissed(true),
        enterLobby: session.enterLobby,
        joinCall,
        leaveCall,
        switchCall,
        returnToCall,
      }}
    >
      {/* Audio always plays regardless of which view is active */}
      {session.meeting && publicStatus === "joined" && (
        <Suspense fallback={null}>
          <LazyRtkParticipantsAudio meeting={session.meeting} />
        </Suspense>
      )}
      {children}
    </ActiveCallContext.Provider>
  );
}
