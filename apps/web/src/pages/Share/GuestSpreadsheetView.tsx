import "jspreadsheet-ce/dist/jspreadsheet.css";
import "jspreadsheet-ce/dist/jspreadsheet.themes.css";
import "jsuites/dist/jsuites.css";
import { useEffect, useRef } from "react";
import { useJSpreadsheetInstance } from "@/hooks/use-jspreadsheet-instance";
import { useGuestDoc } from "@/hooks/use-collab-session";
import { getUserColor } from "@/lib/user-colors";
import type { ShareAccessLevel } from "@ripple/shared/shareTypes";

interface GuestSpreadsheetViewProps {
  shareId: string;
  guestSub: string;
  guestName: string;
  accessLevel: ShareAccessLevel;
}

export function GuestSpreadsheetView({
  shareId,
  guestSub,
  guestName,
  accessLevel,
}: GuestSpreadsheetViewProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const { yDoc, awareness } = useGuestDoc({
    shareId,
    guestSub,
    guestName,
    resourceType: "spreadsheet",
  });

  useEffect(() => {
    awareness.setLocalStateField("user", {
      name: guestName,
      color: getUserColor(guestSub),
    });
  }, [awareness, guestName, guestSub]);

  useJSpreadsheetInstance({
    wrapperRef,
    yDoc,
    awareness,
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
