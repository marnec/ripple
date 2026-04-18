import "jspreadsheet-ce/dist/jspreadsheet.css";
import "jspreadsheet-ce/dist/jspreadsheet.themes.css";
import "jsuites/dist/jsuites.css";
import { useEffect, useRef } from "react";
import { useJSpreadsheetInstance } from "@/hooks/use-jspreadsheet-instance";
import { useGuestYjsProvider } from "@/hooks/use-guest-yjs-provider";
import { getUserColor } from "@/lib/user-colors";
import type { ShareAccessLevel } from "@shared/shareTypes";

interface GuestSpreadsheetViewProps {
  shareId: string;
  guestSub: string;
  guestName: string;
  resourceId: string;
  accessLevel: ShareAccessLevel;
}

export function GuestSpreadsheetView({
  shareId,
  guestSub,
  guestName,
  resourceId,
  accessLevel,
}: GuestSpreadsheetViewProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const { yDoc, provider } = useGuestYjsProvider({
    shareId,
    guestSub,
    guestName,
    resourceType: "spreadsheet",
    resourceId,
  });

  useEffect(() => {
    if (!provider) return;
    provider.awareness.setLocalStateField("user", {
      name: guestName,
      color: getUserColor(guestSub),
    });
  }, [provider, guestName, guestSub]);

  useJSpreadsheetInstance({
    wrapperRef,
    yDoc,
    awareness: provider?.awareness ?? null,
    onEditionStart: () => {},
    onEditionEnd: () => {},
    editable: accessLevel === "edit",
  });

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex-1 overflow-auto p-2" ref={wrapperRef} />
    </div>
  );
}
