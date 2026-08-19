import "jspreadsheet-ce/dist/jspreadsheet.css";
import "jspreadsheet-ce/dist/jspreadsheet.themes.css";
import "jsuites/dist/jsuites.css";
import { useRef } from "react";
import { useJSpreadsheetInstance } from "@/hooks/use-jspreadsheet-instance";
import {
  CollaborativeSurface,
  type HydratedSurface,
  type SurfaceMeta,
} from "@/components/CollaborativeSurface";
import type { CollaborativeDoc } from "@/hooks/use-collaborative-doc";
import type { ShareAccessLevel } from "@ripple/shared/shareTypes";

interface GuestSpreadsheetViewProps {
  /** The room, opened by `GuestResourceView` and shared with the header. */
  doc: CollaborativeDoc;
  accessLevel: ShareAccessLevel;
}

/**
 * A shared spreadsheet, opened for a guest — see `GuestDocumentView`.
 *
 * This is the surface the sequence matters most for: `SpreadsheetYjsBinding`
 * seeded the grid's empty root from its constructor, so mounting it against an
 * unhydrated replica planted a grid beside the real one. The seed now runs
 * post-hydration, and the body it runs in is only mounted once that is true.
 */
export function GuestSpreadsheetView({
  doc,
  accessLevel,
}: GuestSpreadsheetViewProps) {
  return (
    <CollaborativeSurface<SurfaceMeta>
      resourceType="spreadsheet"
      doc={doc}
      meta={undefined}
    >
      {(surface) => (
        <GuestSpreadsheetBody surface={surface} accessLevel={accessLevel} />
      )}
    </CollaborativeSurface>
  );
}

function GuestSpreadsheetBody({
  surface,
  accessLevel,
}: {
  surface: HydratedSurface<SurfaceMeta>;
  accessLevel: ShareAccessLevel;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const { yDoc, awareness, isHydrated } = surface.doc;

  useJSpreadsheetInstance({
    wrapperRef,
    yDoc,
    isHydrated,
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
