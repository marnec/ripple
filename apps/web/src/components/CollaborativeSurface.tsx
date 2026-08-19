import type { ReactNode } from "react";
import { useState } from "react";
import { NotAvailableOffline } from "@/components/NotAvailableOffline";
import { useRoomCached } from "@/hooks/use-room-cached";
import type { CollaborativeDoc } from "@/hooks/use-collaborative-doc";
import { syncState, type SyncState } from "@/lib/collab/connection-policy";
import { NAMED, type SurfaceResourceType } from "@/lib/collab/surface-resources";
import { ResourceDeleted } from "@/pages/ResourceDeleted";

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
   * a device that has the contents but has never had the metadata, and for a
   * guest, whose device keeps no copy of anything.
   */
  meta: TMeta | undefined;
  /** The server is answering — see `useRoomCached`. */
  isLive: boolean;
  /**
   * What to tell the user about this room. Computed here rather than by each
   * consumer because the degraded signal below is this module's state, so this
   * is the only place that can see both halves of it.
   */
  sync: SyncState;
  /**
   * Tell the surface that sync is erroring even though the socket may be up.
   * The body owns this because only the body's binding can detect it — in
   * practice only the diagram's can, so the other bodies never call it.
   */
  reportSyncDegraded: (degraded: boolean) => void;
}

interface CollaborativeSurfaceProps<TMeta extends SurfaceMeta> {
  resourceType: SurfaceResourceType;
  /**
   * The room, already open. Members pass `useResourceDoc`, guests pass
   * `useGuestDoc` — the two ways of proving you may enter, and the only thing
   * that differs between them. Taking the replica rather than the credential
   * is what lets a guest reach this sequence at all.
   */
  doc: CollaborativeDoc;
  /**
   * The metadata query's raw result. `null` means deleted; `undefined` means
   * no answer yet — or, for a guest, that nobody will answer, because a guest's
   * deletion story is told a level up by the share itself going `not_found`.
   */
  meta: TMeta | null | undefined;
  children: (surface: HydratedSurface<TMeta>) => ReactNode;
}

/**
 * One collaborative room, opened.
 *
 * Owns the opening sequence — rule out deletion, refuse an unhydrated replica
 * nothing can reach, hold reserved space while the room is still reachable,
 * then hand the hydrated replica to the body.
 *
 * The sequence used to be re-spelled at every surface, and had drifted: the
 * connecting state reached two of four indicators, one surface offered a
 * settings link that could not load offline, and the reserved space had three
 * spellings. Callers now render bodies, not gates.
 *
 * It owned the member header too, which is what kept guests out: the header
 * cannot work without a workspace and a live server, so admitting a guest meant
 * admitting a caller the header could not serve. The header is now
 * `SurfaceHeader`, rendered by members as the first child of this sequence.
 */
export function CollaborativeSurface<TMeta extends SurfaceMeta>({
  resourceType,
  doc,
  meta: liveMeta,
  children,
}: CollaborativeSurfaceProps<TMeta>) {
  const [syncDegraded, setSyncDegraded] = useState(false);

  // Metadata kept in the room's own store, so offline — where the query never
  // resolves — the surface still knows what it is showing. `isLive` is the
  // verdict every control that would *change* the resource is gated on. For a
  // guest there is no store, and this degrades to the live value unchanged.
  const { value: meta, isLive } = useRoomCached(doc.roomStore, "meta", liveMeta);

  // Only the server can report a resource gone, so this outranks a cached copy.
  if (meta === null) {
    return <ResourceDeleted resourceType={NAMED[resourceType]} />;
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
    sync: syncState(doc, { degraded: syncDegraded }),
    reportSyncDegraded: setSyncDegraded,
  };

  return (
    <div className="flex h-full w-full flex-col animate-fade-in">
      {children(surface)}
    </div>
  );
}
