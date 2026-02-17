import { useToast } from "@/components/ui/use-toast";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Id } from "../../convex/_generated/dataModel";
import { useActiveCall } from "./ActiveCallContext";
import { usePresence } from "./WorkspacePresenceContext";

// 8 distinct accent colors for follow mode identity
const FOLLOW_COLORS = [
  { bg: "bg-blue-500", ring: "ring-blue-500", text: "text-blue-500", hex: "#3b82f6" },
  { bg: "bg-violet-500", ring: "ring-violet-500", text: "text-violet-500", hex: "#8b5cf6" },
  { bg: "bg-amber-500", ring: "ring-amber-500", text: "text-amber-500", hex: "#f59e0b" },
  { bg: "bg-emerald-500", ring: "ring-emerald-500", text: "text-emerald-500", hex: "#10b981" },
  { bg: "bg-rose-500", ring: "ring-rose-500", text: "text-rose-500", hex: "#f43f5e" },
  { bg: "bg-cyan-500", ring: "ring-cyan-500", text: "text-cyan-500", hex: "#06b6d4" },
  { bg: "bg-orange-500", ring: "ring-orange-500", text: "text-orange-500", hex: "#f97316" },
  { bg: "bg-pink-500", ring: "ring-pink-500", text: "text-pink-500", hex: "#ec4899" },
] as const;

type FollowColor = (typeof FOLLOW_COLORS)[number];

function getUserColor(userId: string): FollowColor {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return FOLLOW_COLORS[Math.abs(hash) % FOLLOW_COLORS.length];
}

interface FollowModeContextValue {
  followingUserId: Id<"users"> | null;
  followingUserName: string | null;
  isFollowing: boolean;
  followColor: FollowColor | null;
  startFollowing: (userId: Id<"users">, userName: string) => void;
  stopFollowing: () => void;
}

const FollowModeContext = createContext<FollowModeContextValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useFollowMode() {
  const ctx = useContext(FollowModeContext);
  if (!ctx)
    throw new Error("useFollowMode must be used within FollowModeProvider");
  return ctx;
}

export function FollowModeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [followingUserId, setFollowingUserId] =
    useState<Id<"users"> | null>(null);
  const [followingUserName, setFollowingUserName] = useState<string | null>(
    null,
  );

  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { presenceMap } = usePresence();
  const { status: callStatus } = useActiveCall();

  // Deterministic color from followed user ID
  const followColor = useMemo(
    () => (followingUserId ? getUserColor(followingUserId) : null),
    [followingUserId],
  );

  // Track whether the last navigation was triggered by follow mode
  const followNavRef = useRef(false);
  const lastFollowedPathRef = useRef<string | null>(null);

  // Stable refs for use in callbacks
  const followingUserIdRef = useRef(followingUserId);
  const followingUserNameRef = useRef(followingUserName);
  useEffect(() => {
    followingUserIdRef.current = followingUserId;
    followingUserNameRef.current = followingUserName;
  }, [followingUserId, followingUserName]);

  // Read followed user's presence from the workspace presence map
  const presence = followingUserId
    ? presenceMap.get(followingUserId) ?? null
    : null;

  // Stable callback to clear follow state
  const clearFollowState = useCallback(() => {
    setFollowingUserId(null);
    setFollowingUserName(null);
    lastFollowedPathRef.current = null;
  }, []);

  // --- Escape key to stop following ---
  useEffect(() => {
    if (!followingUserId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        toast({
          title: "Stopped following",
          description: `No longer following ${followingUserNameRef.current}`,
        });
        clearFollowState();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [followingUserId, toast, clearFollowState]);

  // --- Auto-unfollow when leaving call ---
  const prevCallStatusRef = useRef(callStatus);
  useEffect(() => {
    const prev = prevCallStatusRef.current;
    prevCallStatusRef.current = callStatus;

    if (
      prev === "joined" &&
      callStatus !== "joined" &&
      followingUserIdRef.current
    ) {
      requestAnimationFrame(() => {
        if (!followingUserIdRef.current) return;
        toast({
          title: "Stopped following",
          description: `You left the call`,
        });
        clearFollowState();
      });
    }
  }, [callStatus, toast, clearFollowState]);

  // Handle presence changes: navigate or stop following
  // undefined = initial/reset state (prevents false "went offline" toast on follow start)
  const prevPresenceRef = useRef<typeof presence | undefined>(presence);

  useEffect(() => {
    if (!followingUserId) {
      prevPresenceRef.current = presence;
      return;
    }

    // User went offline: presence was previously set, now null
    if (
      presence === null &&
      prevPresenceRef.current !== null &&
      prevPresenceRef.current !== undefined
    ) {
      prevPresenceRef.current = presence;
      // Defer to avoid synchronous setState in effect
      requestAnimationFrame(() => {
        if (!followingUserIdRef.current) return;
        toast({
          title: "Lost connection",
          description: `${followingUserNameRef.current} went offline`,
        });
        clearFollowState();
      });
      return;
    }

    prevPresenceRef.current = presence;

    if (!presence) return;

    const targetPath = presence.currentPath;

    // Detect whether the current location change was manual (user) or programmatic (follow).
    // Must run here — before any re-navigation — to avoid the race where the presence effect
    // reverses a manual navigation before the separate manual-nav effect can stop following.
    if (lastFollowedPathRef.current !== null && location.pathname !== lastFollowedPathRef.current) {
      if (followNavRef.current) {
        // Our own follow-navigation just landed — consume the flag and continue
        followNavRef.current = false;
      } else {
        // User navigated manually → stop following without reversing their navigation
        requestAnimationFrame(() => {
          if (!followingUserIdRef.current) return;
          toast({
            title: "Stopped following",
            description: `You navigated away from ${followingUserNameRef.current}`,
          });
          clearFollowState();
        });
        return;
      }
    }

    // Consume a pending follow-nav flag when we've already arrived at the target
    if (targetPath === location.pathname) {
      followNavRef.current = false;
      return;
    }

    // Navigate to followed user's location
    followNavRef.current = true;
    lastFollowedPathRef.current = targetPath;
    void navigate(targetPath);
  }, [
    presence,
    followingUserId,
    navigate,
    location.pathname,
    toast,
    clearFollowState,
  ]);

  const startFollowing = useCallback(
    (userId: Id<"users">, userName: string) => {
      setFollowingUserId(userId);
      setFollowingUserName(userName);
      lastFollowedPathRef.current = null;
      followNavRef.current = false;
      prevPresenceRef.current = undefined;
      toast({
        title: "Following",
        description: `Now following ${userName}`,
      });
    },
    [toast],
  );

  const stopFollowing = useCallback(() => {
    clearFollowState();
  }, [clearFollowState]);

  return (
    <FollowModeContext.Provider
      value={{
        followingUserId,
        followingUserName,
        isFollowing: followingUserId !== null,
        followColor,
        startFollowing,
        stopFollowing,
      }}
    >
      {children}
    </FollowModeContext.Provider>
  );
}
