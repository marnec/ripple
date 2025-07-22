import { useQuery } from "convex/react";
import usePresence from "@convex-dev/presence/react";
import { useMemo } from "react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

interface EnhancedUserPresence {
  userId: Id<"users">;
  online: boolean;
  name?: string;
  image?: string;
  email?: string;
  lastDisconnected?: number;
}

export function useEnhancedPresence(roomId: string) {
  const viewer = useQuery(api.users.viewer);

  const presenceState = usePresence(
    api.presence,
    roomId || "disabled", // Use a disabled state when no room ID
    viewer?._id ?? "Anonymous", // Pass user ID as presence data
    2000,
  );

  const userIds = useMemo(() => {
    if (!roomId || !presenceState || !Array.isArray(presenceState)) return [];
    return presenceState
      .map((p: any) => p.user)
      .filter((userId): userId is Id<"users"> => userId !== undefined && userId !== null && userId !== "Anonymous");
  }, [roomId, presenceState]);

  const users = useQuery(api.users.getByIds, userIds.length > 0 ? { ids: userIds } : "skip");

  const enhancedPresence = useMemo(() => {
    if (!roomId || !presenceState || !users) return [];

    return presenceState
      .filter((presence: any) => presence.user !== undefined && presence.user !== null && presence.user !== "Anonymous")
      .map((presence: any) => {
        const user = users[presence.user as Id<"users">];
        return {
          userId: presence.user,
          online: presence.online,
          name: user?.name,
          image: user?.image,
          email: user?.email,
          lastDisconnected: presence.lastDisconnected,
        } as EnhancedUserPresence;
      });
  }, [roomId, presenceState, users]);

  return enhancedPresence;
} 