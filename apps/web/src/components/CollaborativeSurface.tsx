import type { ReactNode } from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Settings } from "lucide-react";
import type { Awareness } from "y-protocols/awareness";
import type { Id } from "@convex/_generated/dataModel";
import type { FavoritableResourceType } from "@ripple/shared/types/resources";
import { Button } from "@ripple/ui/components/button";
import { BacklinksButton } from "@/components/BacklinksDrawer";
import { FavoriteButton } from "@/components/FavoriteButton";
import { NotAvailableOffline } from "@/components/NotAvailableOffline";
import { TagInlineStrip, TagPickerButton } from "@/components/TagPickerButton";
import { HeaderSlot, MobileHeaderTitle } from "@/contexts/HeaderSlotContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useRecordVisit } from "@/hooks/use-record-visit";
import { useResourceDoc } from "@/hooks/use-collab-session";
import { useRoomCached } from "@/hooks/use-room-cached";
import type { CollaborativeDoc } from "@/hooks/use-collaborative-doc";
import { ConnectionStatus } from "@/pages/App/Document/ConnectionStatus";
import { ResourceDeleted } from "@/pages/ResourceDeleted";

/**
 * The resources that have a collaborative surface of their own. A task's Yjs
 * room is collaborative too, but its description is a panel inside the task,
 * not a surface — it has no header and no settings route.
 */
export type SurfaceResourceType = "doc" | "diagram" | "spreadsheet";

/** How each surface is named outside the collaboration layer. */
const NAMED: Record<SurfaceResourceType, FavoritableResourceType> = {
  doc: "document",
  diagram: "diagram",
  spreadsheet: "spreadsheet",
};

/** The parts of a resource's metadata every surface header renders. */
export interface SurfaceMeta {
  name: string;
  tags?: string[];
}

/**
 * A collaborative room this device holds the contents of.
 *
 * Handed to the body only once that is true, which is the point: a body that
 * is never mounted against an unhydrated replica cannot author into one.
 */
export interface HydratedSurface<TMeta extends SurfaceMeta> {
  doc: CollaborativeDoc;
  /**
   * The server's answer, or the copy kept for this room. Undefined offline on
   * a device that has the contents but has never had the metadata.
   */
  meta: TMeta | undefined;
  /** The server is answering — see `useRoomCached`. */
  isLive: boolean;
  /**
   * Tell the header that sync is erroring even though the socket may be up.
   * The body owns this because only the body's binding can detect it.
   */
  reportSyncDegraded: (degraded: boolean) => void;
}

interface CollaborativeSurfaceProps<TMeta extends SurfaceMeta> {
  resourceType: SurfaceResourceType;
  resourceId: string;
  /**
   * From the route, not from the metadata query. Every header control needs a
   * workspace, and a workspace read from the server is one the surface does not
   * have offline — which is how visit recording came to work on one surface and
   * not the other two.
   */
  workspaceId: Id<"workspaces">;
  /** The metadata query's raw result. `null` means deleted. */
  meta: TMeta | null | undefined;
  onTagsChange: (tags: string[]) => void;
  /** Tooltip/aria label for the settings link, e.g. "Diagram settings". */
  settingsTitle: string;
  /** Centre of the header bar. The spreadsheet's formula bar. */
  centre?: ReactNode;
  /**
   * Controls that keep working without the server — commenting, presenting
   * from the local scene. Deliberately not `isLive`-gated.
   */
  tools?: ReactNode;
  /** Controls that change the resource. Rendered only while the server answers. */
  actions?: (meta: TMeta) => ReactNode;
  /**
   * Presence avatars. Invoked only while connected — that rule is the module's;
   * deriving users from awareness is the surface's, because the hook that does
   * it differs per resource and the diagram's needs its canvas API.
   */
  activeUsers?: (awareness: Awareness) => ReactNode;
  onBacklinksOpenChange?: (open: boolean) => void;
  children: (surface: HydratedSurface<TMeta>) => ReactNode;
}

/**
 * One collaborative room, presented to a member.
 *
 * Owns the opening sequence — rule out deletion, refuse an unhydrated replica
 * nothing can reach, hold reserved space while the room is still reachable,
 * then hand the hydrated replica to the body — and the header around it.
 *
 * The sequence used to be re-spelled at every surface, and had drifted: the
 * connecting state reached two of four indicators, one surface offered a
 * settings link that could not load offline, and the reserved space had three
 * spellings. Callers now render bodies, not gates.
 */
export function CollaborativeSurface<TMeta extends SurfaceMeta>({
  resourceType,
  resourceId,
  workspaceId,
  meta: liveMeta,
  onTagsChange,
  settingsTitle,
  centre,
  tools,
  actions,
  activeUsers,
  onBacklinksOpenChange,
  children,
}: CollaborativeSurfaceProps<TMeta>) {
  const isMobile = useIsMobile();
  const doc = useResourceDoc({ resourceType, resourceId });
  const [syncDegraded, setSyncDegraded] = useState(false);

  // Metadata kept in the room's own store, so offline — where the query never
  // resolves — the surface still knows what it is showing. `isLive` is the
  // verdict every control that would *change* the resource is gated on.
  const { value: meta, isLive } = useRoomCached(doc.roomStore, "meta", liveMeta);
  const named = NAMED[resourceType];
  useRecordVisit(workspaceId, named, resourceId, meta?.name);

  // Only the server can report a resource gone, so this outranks a cached copy.
  if (meta === null) {
    return <ResourceDeleted resourceType={named} />;
  }

  // Nothing can reach the contents and this device has never held them. An
  // empty body here would be a claim the resource is empty, and every edit made
  // against that claim has to be reconciled against contents never seen.
  if (doc.isOffline && !doc.isHydrated) {
    return <NotAvailableOffline resource={resourceType} />;
  }

  // Still reachable, still unknown. Reserved space rather than a skeleton, and
  // deliberately not gated on the metadata query: offline that query never
  // resolves, and waiting on it stranded a device that had a perfectly good
  // local copy behind a blank page.
  if (!doc.isHydrated) {
    return <div className="h-full w-full flex-1 min-w-0" />;
  }

  const surface: HydratedSurface<TMeta> = {
    doc,
    meta,
    isLive,
    reportSyncDegraded: setSyncDegraded,
  };

  return (
    <div className="flex h-full w-full flex-col animate-fade-in">
      <div className="flex items-center justify-between px-3 py-1.5 border-b">
        <div className="flex h-8 min-w-0 items-center gap-4">
          {isLive && meta && (
            <>
              <FavoriteButton
                resourceType={named}
                resourceId={resourceId}
                workspaceId={workspaceId}
              />
              <TagPickerButton
                workspaceId={workspaceId}
                value={meta.tags ?? []}
                onChange={onTagsChange}
              />
            </>
          )}
          <h1 className="hidden sm:block text-lg font-semibold truncate">
            {meta?.name ?? ""}
          </h1>
          <TagInlineStrip tags={meta?.tags ?? []} />
        </div>
        {centre}
        <div className="flex h-8 items-center gap-3">
          <ConnectionStatus
            isConnected={doc.isConnected}
            isConnecting={doc.isConnecting}
            hasSyncError={syncDegraded}
          />
          {doc.isConnected && activeUsers?.(doc.awareness)}
          {isLive && meta && (
            <BacklinksButton
              resourceId={resourceId}
              workspaceId={workspaceId}
              onOpenChange={onBacklinksOpenChange}
            />
          )}
          {tools}
          {isLive && meta && actions?.(meta)}
          {isLive && meta && !isMobile && (
            <Link
              to="settings"
              className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              title={settingsTitle}
            >
              <Settings className="size-4" />
            </Link>
          )}
        </div>
      </div>
      {isLive && meta && isMobile && (
        <HeaderSlot>
          <Button
            variant="ghost"
            size="icon"
            render={<Link to="settings" />}
            aria-label={settingsTitle}
          >
            <Settings className="size-4" />
          </Button>
        </HeaderSlot>
      )}
      <MobileHeaderTitle name={meta?.name ?? ""} />
      {children(surface)}
    </div>
  );
}
