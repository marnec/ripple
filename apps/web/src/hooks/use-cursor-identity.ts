import { useEffect } from "react";
import type { Awareness } from "y-protocols/awareness";
import { getUserColor } from "@/lib/user-colors";

/**
 * Publish this user's cursor identity on a room's awareness.
 *
 * The whole of what `useSpreadsheetCollaboration` did once the room-opening
 * moved to `CollaborativeSurface`, and the only real behaviour left in the
 * diagram's hook beside the Yjs structures y-excalidraw expects.
 */
export function useCursorIdentity(
  awareness: Awareness,
  userName: string,
  userId: string,
) {
  const color = getUserColor(userId);
  useEffect(() => {
    awareness.setLocalStateField("user", { name: userName, color });
  }, [awareness, userName, color]);
}
