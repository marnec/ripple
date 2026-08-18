import { BacklinksButton } from "@/components/BacklinksDrawer";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { FavoriteButton } from "@/components/FavoriteButton";
import {
  TagInlineStrip,
  TagPickerButton,
} from "@/components/TagPickerButton";
import { Button } from "@ripple/ui/components/button";
import { HeaderSlot, MobileHeaderTitle } from "@/contexts/HeaderSlotContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { tagsOptimisticUpdate } from "@/lib/tag-optimistic";
import { NotAvailableOffline } from "@/components/NotAvailableOffline";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import { Link, useLocation, useParams } from "react-router-dom";
import type { Id } from "@convex/_generated/dataModel";
import { ExcalidrawEditor } from "./ExcalidrawEditor";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { api } from "@convex/_generated/api";
import { useViewer } from "../UserContext";
import { useState } from "react";
import type { ExcalidrawImperativeAPI, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useTheme } from "next-themes";
import { Presentation, Settings } from "lucide-react";
import { DiagramActionsMenu } from "./DiagramActionsMenu";
import { PresentationOverlay } from "./PresentationOverlay";
import { useFrameDeleteProtection } from "@/hooks/use-frame-delete-protection";
import { FrameDeleteWarningDialog } from "@/components/FrameDeleteWarningDialog";
import { useDiagramCollaboration } from "@/hooks/use-diagram-collaboration";
import { useDiagramCursorAwareness } from "@/hooks/use-diagram-cursor-awareness";
import { ActiveUsers } from "../Document/ActiveUsers";
import { ConnectionStatus } from "../Document/ConnectionStatus";
import { localResourceName } from "@/hooks/use-local-recents";
import { useRecordVisit } from "@/hooks/use-record-visit";
import { getExcalidrawCollaboratorColor } from "@/lib/user-colors";
import { getCameraFromAppState } from "@/lib/canvas-coordinates";
import type { Theme } from "@excalidraw/excalidraw/element/types";

type ImportedScene = {
  elements: readonly unknown[];
  files: Record<string, unknown>;
};

function DiagramPageContent({ diagramId, workspaceId }: { diagramId: Id<"diagrams">; workspaceId: Id<"workspaces"> }) {
  const isMobile = useIsMobile();
  const viewer = useViewer();
  const location = useLocation();
  const importedScene =
    (location.state as { importedScene?: ImportedScene } | null)
      ?.importedScene ?? null;
  const diagram = useQuery(api.diagrams.get, { id: diagramId });
  useRecordVisit(workspaceId, "diagram", diagramId, diagram?.name);
  // Offline the metadata query never resolves; recents is the only place a
  // name for this diagram survives on the device.
  const diagramName = diagram?.name ?? localResourceName(diagramId) ?? "";
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  // Snapshot of the scene captured when entering presentation mode (null = not presenting).
  const [presentationScene, setPresentationScene] = useState<{
    elements: readonly ExcalidrawElement[];
    files: BinaryFiles;
  } | null>(null);
  // Set by the editor when the Yjs binding starts throwing. Editing keeps
  // working; this only tells the user their changes aren't being shared.
  const [syncDegraded, setSyncDegraded] = useState(false);
  const myRole = useQuery(api.workspaceMembers.myRole, { workspaceId });
  const isAdmin = myRole === "admin";

  // Per-frame embeds of this diagram: drives the "delete an embedded frame"
  // warning. Each row is one (source, frame) place that embeds a specific frame.
  const frameEmbeds = useQuery(
    api.edges.getFrameEmbeds,
    diagram ? { diagramId, workspaceId } : "skip",
  );
  const embeddedFrameIds = new Set((frameEmbeds ?? []).map((r) => r.frameId));
  // Pending guarded deletion: the embedded frames + the full selection to
  // remove on confirm (so we reproduce Excalidraw's "delete frame + contents").
  const [frameDeleteTarget, setFrameDeleteTarget] = useState<{
    frameIds: string[];
    selectedIds: string[];
    frameName?: string;
  } | null>(null);

  useFrameDeleteProtection({
    api: excalidrawAPI,
    enabled: true,
    embeddedFrameIds,
    onIntercept: (frameIds, selectedIds) => {
      const firstFrame = excalidrawAPI
        ?.getSceneElements()
        .find((el) => el.id === frameIds[0]) as
        | { name?: string | null }
        | undefined;
      setFrameDeleteTarget({
        frameIds,
        selectedIds,
        frameName: firstFrame?.name ?? undefined,
      });
    },
  });

  const confirmFrameDelete = () => {
    if (!excalidrawAPI || !frameDeleteTarget) return;
    const { frameIds, selectedIds } = frameDeleteTarget;
    const frameSet = new Set(frameIds);
    const selectedSet = new Set(selectedIds);
    // Keep the frame's contents: detach members of a guarded frame (clear their
    // frameId so they don't dangle off a deleted frame) and delete only the
    // frame outline — plus any other explicitly-selected elements.
    const next = excalidrawAPI.getSceneElements().map((el) => {
      if (el.frameId && frameSet.has(el.frameId)) {
        return { ...el, frameId: null };
      }
      if (selectedSet.has(el.id)) {
        return { ...el, isDeleted: true };
      }
      return el;
    });
    excalidrawAPI.updateScene({
      elements: next,
      appState: { selectedElementIds: {} },
    });
    setFrameDeleteTarget(null);
  };
  const updateTags = useMutation(api.diagrams.updateTags).withOptimisticUpdate(
    tagsOptimisticUpdate(api.diagrams.get),
  );
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme === "dark";

  // Set up Yjs collaboration
  const {
    yElements,
    yAssets,
    awareness,
    provider,
    isConnected,
    isOffline,
    isLoading,
    isHydrated,
  } = useDiagramCollaboration({
    diagramId,
    userName: viewer?.name ?? "Anonymous",
    userId: viewer?._id ?? "anonymous",
  });

  // Get remote pointers for jump-to-user and avatar stack
  const { remotePointers } = useDiagramCursorAwareness(awareness);

  // Jump to user's cursor position
  const handleJumpToUser = (user: { clientId: number }) => {
    if (!excalidrawAPI) return;

    const remotePointer = remotePointers.find((p) => p.clientId === user.clientId);
    if (!remotePointer?.pointer) return;

    const appState = excalidrawAPI.getAppState();
    const camera = getCameraFromAppState(appState);
    const viewportCenterX = window.innerWidth / 2;
    const viewportCenterY = window.innerHeight / 2;

    // Calculate new scroll position to center on pointer
    const newScrollX = viewportCenterX / camera.z - remotePointer.pointer.x;
    const newScrollY = viewportCenterY / camera.z - remotePointer.pointer.y;

    excalidrawAPI.updateScene({
      appState: {
        scrollX: newScrollX,
        scrollY: newScrollY,
      },
    });
  };

  if (diagram === null) {
    return <ResourceDeleted resourceType="diagram" />;
  }

  // Nothing can reach this diagram's contents and this device has never held
  // them. A blank canvas here would be a lie the user can draw on — and every
  // stroke would then have to be reconciled against a scene they never saw.
  if (isOffline && !isHydrated) {
    return <NotAvailableOffline resource="diagram" />;
  }

  // `viewer` and `diagram` are Convex reads, so offline they never resolve.
  // Wait for them only while we might still get them: once the Yjs document is
  // hydrated we can draw the canvas and let the header degrade.
  if (!isHydrated && (!viewer || diagram === undefined)) {
    return <div className="h-full w-full" />;
  }

  return (
    <div className="flex h-full w-full flex-col animate-fade-in">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b">
        <div className="flex h-8 min-w-0 items-center gap-4">
          <FavoriteButton
            resourceType="diagram"
            resourceId={diagramId}
            workspaceId={workspaceId}
          />
          <TagPickerButton
            workspaceId={workspaceId}
            value={diagram?.tags ?? []}
            onChange={(tags) => void updateTags({ id: diagramId, tags })}
          />
          <h1 className="hidden sm:block text-lg font-semibold truncate">{diagramName}</h1>
          <TagInlineStrip tags={diagram?.tags ?? []} />
        </div>
        <div className="flex h-8 items-center gap-3">
          <ConnectionStatus isConnected={isConnected} hasSyncError={syncDegraded} />
          {isConnected && (
            <ActiveUsers
              remoteUsers={remotePointers.map((p) => ({
                ...p,
                cursor: p.pointer ? { anchor: 0, head: 0 } : null,
              }))}
              currentUser={viewer && awareness ? { name: viewer.name, color: getExcalidrawCollaboratorColor(awareness.clientID, isDarkTheme) } : undefined}
              onUserClick={handleJumpToUser}
            />
          )}
          <BacklinksButton resourceId={diagramId} workspaceId={workspaceId} />
          {diagram && (
            <button
              type="button"
              onClick={() => {
                if (!excalidrawAPI) return;
                setPresentationScene({
                  elements: excalidrawAPI.getSceneElements(),
                  files: excalidrawAPI.getFiles(),
                });
              }}
              disabled={!excalidrawAPI}
              className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50"
              title="Present"
            >
              <Presentation className="size-4" />
            </button>
          )}
          {diagram && (
            <DiagramActionsMenu
              diagramId={diagramId}
              diagramName={diagram.name}
              isAdmin={isAdmin}
              excalidrawAPI={excalidrawAPI}
            />
          )}
          {!isMobile && (
            <Link
              to="settings"
              className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              title="Diagram settings"
            >
              <Settings className="size-4" />
            </Link>
          )}
        </div>
      </div>
      {isMobile && (
        <HeaderSlot>
          <Button
            variant="ghost"
            size="icon"
            render={<Link to="settings" />}
            aria-label="Diagram settings"
          >
            <Settings className="size-4" />
          </Button>
        </HeaderSlot>
      )}
      <MobileHeaderTitle name={diagramName} />

      {/* Canvas */}
      <div className="flex-1 overflow-hidden">
        {/* Last resort: anything the sync guard doesn't contain takes down the
            canvas only, and remounts it from the (intact) Yjs document instead
            of forcing a full page reload. */}
        <ErrorBoundary
          fallback={({ reset }) => (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
              <p className="text-sm text-muted-foreground">
                The canvas stopped unexpectedly. Your diagram is saved.
              </p>
              <Button variant="outline" size="sm" onClick={reset}>
                Reload canvas
              </Button>
            </div>
          )}
        >
          {!isLoading && (
            <ExcalidrawEditor
              yElements={yElements}
              yAssets={yAssets}
              awareness={awareness}
              provider={provider}
              onExcalidrawAPI={setExcalidrawAPI}
              importedScene={importedScene}
              onSyncDegradedChange={setSyncDegraded}
            />
          )}
        </ErrorBoundary>
      </div>

      {presentationScene && (
        <PresentationOverlay
          elements={presentationScene.elements}
          files={presentationScene.files}
          theme={resolvedTheme as Theme}
          onClose={() => setPresentationScene(null)}
        />
      )}

      <FrameDeleteWarningDialog
        open={frameDeleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setFrameDeleteTarget(null);
        }}
        onConfirm={confirmFrameDelete}
        frameName={frameDeleteTarget?.frameName}
        references={
          frameDeleteTarget
            ? (frameEmbeds ?? []).filter((r) =>
                frameDeleteTarget.frameIds.includes(r.frameId),
              )
            : []
        }
      />
    </div>
  );
}

export function DiagramPage() {
  const { diagramId, workspaceId } = useParams<{ diagramId: Id<"diagrams">; workspaceId: Id<"workspaces"> }>();
  if (!diagramId || !workspaceId) {
    return null;
  }
  return <DiagramPageContent diagramId={diagramId} workspaceId={workspaceId} key={diagramId} />;
}
