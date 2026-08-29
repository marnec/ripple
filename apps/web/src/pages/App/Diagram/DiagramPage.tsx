import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@ripple/ui/components/button";
import { tagsOptimisticUpdate } from "@/lib/tag-optimistic";
import { useLocation, useParams } from "react-router-dom";
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
import { Presentation } from "lucide-react";
import { DiagramActionsMenu } from "./DiagramActionsMenu";
import { DiagramActiveUsers } from "./DiagramActiveUsers";
import { PresentationOverlay } from "./PresentationOverlay";
import { useFrameDeleteProtection } from "@/hooks/use-frame-delete-protection";
import { FrameDeleteWarningDialog } from "@/components/FrameDeleteWarningDialog";
import { useDiagramCollaboration } from "@/hooks/use-diagram-collaboration";
import {
  CollaborativeSurface,
  type HydratedSurface,
} from "@/components/CollaborativeSurface";
import { SurfaceHeader } from "@/components/SurfaceHeader";
import { useResourceDoc } from "@/hooks/use-collab-session";
import type { Theme } from "@excalidraw/excalidraw/element/types";

type ImportedScene = {
  elements: readonly unknown[];
  files: Record<string, unknown>;
};

/** What the header renders for a diagram. */
interface DiagramMeta {
  name: string;
  tags?: string[];
}

function DiagramPageContent({
  diagramId,
  workspaceId,
}: {
  diagramId: Id<"diagrams">;
  workspaceId: Id<"workspaces">;
}) {
  const viewer = useViewer();
  const location = useLocation();
  const { resolvedTheme } = useTheme();
  // The room, opened here and handed to the sequence.
  const doc = useResourceDoc({ resourceType: "diagram", resourceId: diagramId });
  const importedScene =
    (location.state as { importedScene?: ImportedScene } | null)?.importedScene ?? null;
  const liveDiagram = useQuery(api.diagrams.get, { id: diagramId });
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  // Snapshot of the scene captured when entering presentation mode (null = not presenting).
  const [presentationScene, setPresentationScene] = useState<{
    elements: readonly ExcalidrawElement[];
    files: BinaryFiles;
  } | null>(null);
  const myRole = useQuery(api.workspaceMembers.myRole, { workspaceId });
  const isAdmin = myRole === "admin";
  const updateTags = useMutation(api.diagrams.updateTags).withOptimisticUpdate(
    tagsOptimisticUpdate(api.diagrams.get),
  );

  // Per-frame embeds of this diagram: drives the "delete an embedded frame"
  // warning. Each row is one (source, frame) place that embeds a specific frame.
  const frameEmbeds = useQuery(
    api.edges.getFrameEmbeds,
    // The live row, not the cached one: this is another server read, so there
    // is nothing to gain from asking for it on the strength of a cached copy.
    liveDiagram ? { diagramId, workspaceId } : "skip",
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
        .find((el) => el.id === frameIds[0]) as { name?: string | null } | undefined;
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

  return (
    <CollaborativeSurface<DiagramMeta>
      resourceType="diagram"
      doc={doc}
      meta={liveDiagram}
    >
      {(surface) => (
        <>
          <SurfaceHeader
            surface={surface}
            resourceType="diagram"
            resourceId={diagramId}
            workspaceId={workspaceId}
            onTagsChange={(tags) => void updateTags({ id: diagramId, tags })}
            settingsTitle="Diagram settings"
            focusable
            activeUsers={(awareness) => (
              <DiagramActiveUsers
                awareness={awareness}
                excalidrawAPI={excalidrawAPI}
                viewer={viewer}
              />
            )}
            tools={
              // Presenting reads the local scene, so it keeps working with no server.
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
            }
            actions={(meta) => (
              <DiagramActionsMenu
                diagramId={diagramId}
                diagramName={meta.name}
                isAdmin={isAdmin}
                excalidrawAPI={excalidrawAPI}
              />
            )}
          />
          <DiagramCanvas
            surface={surface}
            viewer={viewer}
            importedScene={importedScene}
            onExcalidrawAPI={setExcalidrawAPI}
          />

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
        </>
      )}
    </CollaborativeSurface>
  );
}

/**
 * The canvas itself, bound to a replica that is known to hold the diagram.
 * Mounted by `CollaborativeSurface` only once that is true.
 */
function DiagramCanvas({
  surface,
  viewer,
  importedScene,
  onExcalidrawAPI,
}: {
  surface: HydratedSurface<DiagramMeta>;
  viewer: { _id?: string; name?: string } | null | undefined;
  importedScene: ImportedScene | null;
  onExcalidrawAPI: (api: ExcalidrawImperativeAPI) => void;
}) {
  const { yElements, yAssets } = useDiagramCollaboration({
    doc: surface.doc,
    userName: viewer?.name ?? "Anonymous",
    userId: viewer?._id ?? "anonymous",
  });

  return (
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
        <ExcalidrawEditor
          yElements={yElements}
          yAssets={yAssets}
          awareness={surface.doc.awareness}
          provider={surface.doc.provider}
          onExcalidrawAPI={onExcalidrawAPI}
          importedScene={importedScene}
          onSyncDegradedChange={surface.reportSyncDegraded}
        />
      </ErrorBoundary>
    </div>
  );
}

export function DiagramPage() {
  const { diagramId, workspaceId } = useParams<{
    diagramId: Id<"diagrams">;
    workspaceId: Id<"workspaces">;
  }>();
  if (!diagramId || !workspaceId) {
    return null;
  }
  return (
    <DiagramPageContent diagramId={diagramId} workspaceId={workspaceId} key={diagramId} />
  );
}
