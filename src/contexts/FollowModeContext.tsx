import { useToast } from "@/components/ui/use-toast";
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
import { usePresence } from "./WorkspacePresenceContext";

interface FollowModeContextValue {
  followingUserId: Id<"users"> | null;
  followingUserName: string | null;
  isFollowing: boolean;
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
    if (targetPath === location.pathname) return;

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

  // Detect manual navigation (user navigated themselves, not via follow)
  useEffect(() => {
    if (!followingUserId) return;

    if (followNavRef.current) {
      followNavRef.current = false;
      return;
    }

    if (
      lastFollowedPathRef.current &&
      location.pathname !== lastFollowedPathRef.current
    ) {
      // Defer to avoid synchronous setState in effect
      requestAnimationFrame(() => {
        if (!followingUserIdRef.current) return;
        toast({
          title: "Stopped following",
          description: `You navigated away from ${followingUserNameRef.current}`,
        });
        clearFollowState();
      });
    }
  }, [location.pathname, followingUserId, toast, clearFollowState]);

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
        startFollowing,
        stopFollowing,
      }}
    >
      {children}
    </FollowModeContext.Provider>
  );
}
