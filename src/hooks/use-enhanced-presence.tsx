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
    roomId,
    viewer?._id ?? "Anonymous", // Pass user ID as presence data
    2000,
  );

  const userIds = useMemo(() => {
    if (!presenceState || !Array.isArray(presenceState)) return [];
    return presenceState.map((p: any) => p.user);
  }, [presenceState]);

  const users = useQuery(api.users.getByIds, { ids: userIds as Id<"users">[] });

  const enhancedPresence = useMemo(() => {
    if (!presenceState || !users) return [];

    return presenceState.map((presence: any) => {
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
  }, [presenceState, users]);

  return enhancedPresence;
} 