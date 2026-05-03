import { ExcalidrawEditor } from "@/pages/App/Diagram/ExcalidrawEditor";
import { useGuestYjsProvider } from "@/hooks/use-guest-yjs-provider";
import { getUserColor } from "@/lib/user-colors";
import { useEffect } from "react";
import type { ShareAccessLevel } from "@ripple/shared/shareTypes";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type * as Y from "yjs";

interface GuestDiagramViewProps {
  shareId: string;
  guestSub: string;
  guestName: string;
  resourceId: string;
  accessLevel: ShareAccessLevel;
}

export function GuestDiagramView({
  shareId,
  guestSub,
  guestName,
  resourceId,
  accessLevel,
}: GuestDiagramViewProps) {
  const { yDoc, provider } = useGuestYjsProvider({
    shareId,
    guestSub,
    guestName,
    resourceType: "diagram",
    resourceId,
  });

  const yElements = yDoc.getArray<Y.Map<any>>("elements");
  const yAssets = yDoc.getMap("assets");

  useEffect(() => {
    if (!provider) return;
    provider.awareness.setLocalStateField("user", {
      name: guestName,
      color: getUserColor(guestSub),
    });
  }, [provider, guestName, guestSub]);

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
        viewModeEnabled={accessLevel !== "edit"}
      />
    </div>
  );
}
