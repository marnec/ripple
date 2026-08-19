import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Settings } from "lucide-react";
import type { Awareness } from "y-protocols/awareness";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@ripple/ui/components/button";
import { BacklinksButton } from "@/components/BacklinksDrawer";
import { FavoriteButton } from "@/components/FavoriteButton";
import { SyncIndicator } from "@/components/SyncIndicator";
import { TagInlineStrip, TagPickerButton } from "@/components/TagPickerButton";
import {
  type HydratedSurface,
  type SurfaceMeta,
} from "@/components/CollaborativeSurface";
import { NAMED, type SurfaceResourceType } from "@/lib/collab/surface-resources";
import { HeaderSlot, MobileHeaderTitle } from "@/contexts/HeaderSlotContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useRecordVisit } from "@/hooks/use-record-visit";

interface SurfaceHeaderProps<TMeta extends SurfaceMeta> {
  /** The open room, from the sequence this header is a child of. */
  surface: HydratedSurface<TMeta>;
  resourceType: SurfaceResourceType;
  resourceId: string;
  /**
   * From the route, not from the metadata query. Every control here needs a
   * workspace, and a workspace read from the server is one the surface does not
   * have offline — which is how visit recording came to work on one surface and
   * not the other two.
   */
  workspaceId: Id<"workspaces">;
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
   * Presence avatars. Invoked only while connected — that rule is this
   * module's; deriving users from awareness is the surface's, because the hook
   * that does it differs per resource and the diagram's needs its canvas API.
   */
  activeUsers?: (awareness: Awareness) => ReactNode;
  onBacklinksOpenChange?: (open: boolean) => void;
}

/**
 * The chrome a *member* gets around a collaborative room.
 *
 * Every control here needs a workspace and, for most of them, a server that is
 * answering — which is why this is a separate module from the opening sequence
 * rather than part of it. A guest has neither, and gets the sequence without
 * this. Their chrome is the share's own header, one level up in
 * `GuestResourceView`.
 *
 * The rule the `isLive` gating encodes: controls that would *change* the
 * resource are offered only while the server is answering. Tools that work
 * against the local copy — commenting, presenting — are not gated.
 */
export function SurfaceHeader<TMeta extends SurfaceMeta>({
  surface,
  resourceType,
  resourceId,
  workspaceId,
  onTagsChange,
  settingsTitle,
  centre,
  tools,
  actions,
  activeUsers,
  onBacklinksOpenChange,
}: SurfaceHeaderProps<TMeta>) {
  const isMobile = useIsMobile();
  const { doc, meta, isLive, sync } = surface;
  const named = NAMED[resourceType];

  useRecordVisit(workspaceId, named, resourceId, meta?.name);

  return (
    <>
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
          <SyncIndicator state={sync} />
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
    </>
  );
}
