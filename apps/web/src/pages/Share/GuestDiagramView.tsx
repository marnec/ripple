import { ExcalidrawEditor } from "@/pages/App/Diagram/ExcalidrawEditor";
import { NotAvailableOffline } from "@/components/NotAvailableOffline";
import { useGuestDoc } from "@/hooks/use-collab-session";
import { getUserColor } from "@/lib/user-colors";
import { useEffect } from "react";
import type { ShareAccessLevel } from "@ripple/shared/shareTypes";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type * as Y from "yjs";

interface GuestDiagramViewProps {
  shareId: string;
  guestSub: string;
  guestName: string;
  accessLevel: ShareAccessLevel;
}

export function GuestDiagramView({
  shareId,
  guestSub,
  guestName,
  accessLevel,
}: GuestDiagramViewProps) {
  const { yDoc, provider, awareness, isHydrated, isOffline } = useGuestDoc({
    shareId,
    guestSub,
    guestName,
    resourceType: "diagram",
  });

  const yElements = yDoc.getArray<Y.Map<any>>("elements");
  const yAssets = yDoc.getMap("assets");

  useEffect(() => {
    awareness.setLocalStateField("user", {
      name: guestName,
      color: getUserColor(guestSub),
    });
  }, [awareness, guestName, guestSub]);

  // See GuestDocumentView: no cache, so only a sync can hydrate a guest.
  if (isOffline && !isHydrated) {
    return <NotAvailableOffline resource="diagram" />;
  }

  return (
    <div className="h-full w-full">
      <ExcalidrawEditor
        yElements={yElements}
        yAssets={yAssets}
        awareness={provider?.awareness ?? null}
        provider={provider}
        onExcalidrawAPI={(_api: ExcalidrawImperativeAPI) => {
          // no-op — guests don't need access to the API beyond the built-in binding
        }}
        viewModeEnabled={accessLevel !== "edit" || !isHydrated}
      />
    </div>
  );
}
