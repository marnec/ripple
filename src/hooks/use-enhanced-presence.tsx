import { useQuery } from "convex/react";
import usePresence from "@convex-dev/presence/react";
import { useMemo } from "react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

interface EnhancedUserPresence {
  userId: string;
  online: boolean;
  name?: string;
  image?: string;
  email?: string;
  lastDisconnected?: number;
}

export function useEnhancedPresence(
  roomId: Id<"documents"> | Id<"diagrams">
) {
  const viewer = useQuery(api.users.viewer);
  
  // Get the raw presence data - pass the user's name as expected
  const presenceState = usePresence(
    api.presence,
    roomId,
    viewer?.name ?? "Anonymous",
    2000
  );

  // Enhance presence data with user information
  const enhancedPresence = useMemo(() => {
    if (!presenceState || !Array.isArray(presenceState)) return [];

    return presenceState.map((presence: any) => {
      // Handle different presence data formats
      let userId: string;
      let online: boolean = true;
      let lastDisconnected: number | undefined;

      if (typeof presence === 'string') {
        userId = presence;
      } else if (typeof presence === 'object') {
        userId = presence.userId || presence.user || presence;
        online = presence.online ?? true;
        lastDisconnected = presence.lastDisconnected;
      } else {
        userId = String(presence);
      }

      // For the current user, use the viewer data
      if (userId === viewer?._id || userId === viewer?.name) {
        return {
          userId: viewer._id,
          online,
          name: viewer.name,
          image: viewer.image,
          email: viewer.email,
          lastDisconnected,
        } as EnhancedUserPresence;
      }

      // For other users, we'll show what information we have
      // In a real app, you might want to fetch user data for other users too
      return {
        userId,
        online,
        name: userId,
        image: undefined,
        email: undefined,
        lastDisconnected,
      } as EnhancedUserPresence;
    });
  }, [presenceState, viewer]);

  return enhancedPresence;
} 