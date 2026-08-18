import { useEffect } from "react";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { getUserColor } from "../lib/user-colors";
import { useResourceDoc } from "./use-collab-session";
import type { CollaborativeDoc } from "./use-collaborative-doc";

export interface UseSpreadsheetCollaborationOptions {
  spreadsheetId: string;
  userName: string;
  userId: string;
}

export interface UseSpreadsheetCollaborationResult {
  yDoc: Y.Doc;
  provider: CollaborativeDoc["provider"];
  awareness: Awareness;
  isConnected: boolean;
  isOffline: boolean;
  /** Still trying to reach the room — see `CollaborativeDoc.isConnecting`. */
  isConnecting: boolean;
  isLoading: boolean;
  /** See `CollaborativeDoc.isHydrated` — false means "contents unknown". */
  isHydrated: boolean;
  /** This room's local key/value store — see `CollaborativeDoc.roomStore`. */
  roomStore: CollaborativeDoc["roomStore"];
}

/**
 * Binds a spreadsheet's collaborative document to this user's cursor identity.
 *
 * `SpreadsheetYjsBinding` (created in the component) does the two-way sync
 * between jspreadsheet-ce and the Yjs document; everything about *getting* a
 * synced document belongs to `useResourceDoc`.
 */
export function useSpreadsheetCollaboration({
  spreadsheetId,
  userName,
  userId,
}: UseSpreadsheetCollaborationOptions): UseSpreadsheetCollaborationResult {
  const { yDoc, provider, awareness, isConnected, isLoading, isOffline, isHydrated, roomStore, isConnecting } =
    useResourceDoc({
      resourceType: "spreadsheet",
      resourceId: spreadsheetId,
    });

  const userColor = getUserColor(userId);
  useEffect(() => {
    awareness.setLocalStateField("user", { name: userName, color: userColor });
  }, [awareness, userName, userColor]);

  return {
    yDoc,
    provider,
    awareness,
    isConnected,
    isConnecting,
    isOffline,
    isLoading,
    isHydrated,
    roomStore,
  };
}
