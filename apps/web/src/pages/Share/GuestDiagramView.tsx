import { ExcalidrawEditor } from "@/pages/App/Diagram/ExcalidrawEditor";
import {
  CollaborativeSurface,
  type HydratedSurface,
  type SurfaceMeta,
} from "@/components/CollaborativeSurface";
import type { CollaborativeDoc } from "@/hooks/use-collaborative-doc";
import type { ShareAccessLevel } from "@ripple/shared/shareTypes";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type * as Y from "yjs";

interface GuestDiagramViewProps {
  /** The room, opened by `GuestResourceView` and shared with the header. */
  doc: CollaborativeDoc;
  accessLevel: ShareAccessLevel;
}

/** A shared diagram, opened for a guest — see `GuestDocumentView`. */
export function GuestDiagramView({ doc, accessLevel }: GuestDiagramViewProps) {
  return (
    <CollaborativeSurface<SurfaceMeta>
      resourceType="diagram"
      doc={doc}
      meta={undefined}
    >
      {(surface) => (
        <GuestDiagramBody surface={surface} accessLevel={accessLevel} />
      )}
    </CollaborativeSurface>
  );
}

function GuestDiagramBody({
  surface,
  accessLevel,
}: {
  surface: HydratedSurface<SurfaceMeta>;
  accessLevel: ShareAccessLevel;
}) {
  const { yDoc, provider, awareness } = surface.doc;

  return (
    <div className="h-full w-full">
      <ExcalidrawEditor
        yElements={yDoc.getArray<Y.Map<any>>("elements")}
        yAssets={yDoc.getMap("assets")}
        // The replica's awareness, which is the provider's once connected and a
        // local one before that. Reading it off the provider — as this used to
        // — hands the canvas `null` for as long as the socket is not up.
        awareness={awareness}
        provider={provider}
        onExcalidrawAPI={(_api: ExcalidrawImperativeAPI) => {
          // no-op — guests don't need access to the API beyond the built-in binding
        }}
        viewModeEnabled={accessLevel !== "edit"}
      />
    </div>
  );
}
