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

export function useEnhancedPresence(roomId: string): EnhancedUserPresence[] {
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
      .map((p) => p.userId)
      .filter((id): id is Id<"users"> => id !== undefined && id !== null && id !== "Anonymous");
  }, [roomId, presenceState]);

  const users = useQuery(api.users.getByIds, userIds.length > 0 ? { ids: userIds } : "skip");

  const enhancedPresence = useMemo(() => {
    if (!roomId || !presenceState || !users) return [];

    return presenceState
      .filter((presence) => presence.userId !== undefined && presence.userId !== null && presence.userId !== "Anonymous")
      .map((presence) => {
        const user = users[presence.userId as Id<"users">];
        return {
          userId: presence.userId as Id<"users">,
          online: presence.online,
          name: user?.name,
          image: user?.image,
          email: user?.email,
          lastDisconnected: presence.lastDisconnected,
        } satisfies EnhancedUserPresence;
      });
  }, [roomId, presenceState, users]);

  return enhancedPresence;
} 