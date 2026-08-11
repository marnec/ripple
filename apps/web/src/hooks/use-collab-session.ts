import { useAction, useConvexAuth } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "@convex/_generated/api";
import type { ShareResourceType } from "@ripple/shared/shareTypes";
import { yjsResourceTypeForShare } from "@ripple/shared/shareTypes";
import { collabRoom, type CollabResourceType } from "@/lib/collab/room";
import {
  useCollaborativeDoc,
  type CollaborativeDoc,
  type CollabSession,
} from "./use-collaborative-doc";

/**
 * The two ways into a collaborative room.
 *
 * Members and guests differ in exactly one respect — how they prove they may
 * enter — so that is all these hooks supply. Everything downstream (provider,
 * persistence, awareness, reconnection, teardown) is the same code for both,
 * which is what stops the guest path quietly falling behind the member path
 * the way it did when each owned a full copy of the lifecycle.
 */

/** A workspace member opening one of their workspace's resources. */
export function useResourceDoc({
  resourceType,
  resourceId,
  enabled = true,
}: {
  resourceType: CollabResourceType;
  resourceId: string;
  enabled?: boolean;
}): CollaborativeDoc {
  const { isAuthenticated } = useConvexAuth();
  const mintToken = useAction(api.collaboration.getCollaborationToken);
  const mintRef = useRef(mintToken);
  // Per React Compiler rules this has to be an effect, not a render-time write.
  useEffect(() => {
    mintRef.current = mintToken;
  });

  const room = collabRoom(resourceType, resourceId);
  const session: CollabSession = {
    key: room.roomId,
    room,
    mint: () => mintRef.current({ resourceType, resourceId }),
  };

  return useCollaborativeDoc({ session, enabled: enabled && isAuthenticated });
}

/**
 * A guest arriving through a share link.
 *
 * Guest tokens are minted per share *and* per guest identity, and the server —
 * not the client — decides which room the share resolves to. So the session
 * key is the guest identity rather than the room, and it carries no room:
 * without one, `useCollaborativeDoc` keeps no offline cache, which is the
 * behaviour we want for a link that can be revoked.
 */
export function useGuestDoc({
  shareId,
  guestSub,
  guestName,
  resourceType,
  enabled = true,
}: {
  shareId: string;
  guestSub: string;
  guestName: string;
  resourceType: ShareResourceType;
  enabled?: boolean;
}): CollaborativeDoc {
  const mintToken = useAction(api.shares.getGuestCollaborationToken);
  const mintRef = useRef(mintToken);
  useEffect(() => {
    mintRef.current = mintToken;
  });

  // Channel and calendar shares grant call access only — there is no document.
  const hasDocument = yjsResourceTypeForShare(resourceType) !== null;

  const session: CollabSession = {
    key: `guest:${shareId}:${guestSub}:${guestName}`,
    room: null,
    mint: () => mintRef.current({ shareId, guestSub, guestName }),
  };

  return useCollaborativeDoc({ session, enabled: enabled && hasDocument });
}
