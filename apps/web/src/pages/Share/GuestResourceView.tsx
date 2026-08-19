import { RippleSpinner } from "@/components/RippleSpinner";
import { SyncIndicator } from "@/components/SyncIndicator";
import { useQuery } from "convex-helpers/react/cache";
import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
import { useGuestDoc } from "@/hooks/use-collab-session";
import { useCursorIdentity } from "@/hooks/use-cursor-identity";
import { syncState } from "@/lib/collab/connection-policy";
import { getUserColor } from "@/lib/user-colors";
import { yjsResourceTypeForShare } from "@ripple/shared/shareTypes";
import { loadGuestSession } from "./guestSession";
import { GuestDocumentView } from "./GuestDocumentView";
import { GuestDiagramView } from "./GuestDiagramView";
import { GuestSpreadsheetView } from "./GuestSpreadsheetView";
import { GuestCallView } from "./GuestCallView";
import { GuestEventView } from "./GuestEventView";

/**
 * Guest resource surface at `/share/:shareId/view`.
 *
 * The entry page (`/share/:shareId`) has already collected a display name
 * and generated a `guestSub`. We re-validate the share here, and dispatch
 * to the right per-resource component. If the share is no longer active
 * or there is no guest session in storage, bounce back to the entry page.
 *
 * The room is opened *here*, once, rather than inside each per-resource view:
 * the header this page already renders is where a guest's sync indicator and
 * cursor identity belong, and `useGuestDoc` disables itself for the share kinds
 * that have no document at all (channel, calendarEvent), so one unconditional
 * call serves all five.
 *
 * A guest's deletion story is told here too. Deleting a document, diagram or
 * spreadsheet cascade-deletes its `resourceShares` row, so `getShareInfo` flips
 * to `not_found` and this page unmounts the view — which is why the opening
 * sequence's own deleted stage never fires for a guest.
 */
export function GuestResourceView() {
  const { shareId } = useParams<{ shareId: string }>();
  const navigate = useNavigate();
  const info = useQuery(
    api.shares.getShareInfo,
    shareId ? { shareId } : "skip",
  );
  const session = useMemo(
    () => (shareId ? loadGuestSession(shareId) : null),
    [shareId],
  );

  useEffect(() => {
    if (!shareId) return;
    if (!session) {
      void navigate(`/share/${shareId}`, { replace: true });
    }
  }, [shareId, session, navigate]);

  // Unconditional: hooks cannot sit after the early returns below, and the
  // hook self-disables until there is an active share with a document behind it.
  const doc = useGuestDoc({
    shareId: shareId ?? "",
    guestSub: session?.guestSub ?? "",
    guestName: session?.guestName ?? "",
    resourceType: info?.resourceType ?? "channel",
    enabled: info?.status === "active" && !!session,
  });
  useCursorIdentity(
    doc.awareness,
    session?.guestName ?? "Guest",
    session?.guestSub ?? "guest",
  );

  if (!shareId) return null;
  if (info === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <RippleSpinner size={48} />
      </div>
    );
  }

  if (info.status !== "active") {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 text-center">
        <div className="max-w-md space-y-2">
          <h1 className="text-xl font-semibold">Link no longer available</h1>
          <p className="text-sm text-muted-foreground">
            {info.status === "expired" ? "This share link has expired." :
             info.status === "revoked" ? "The workspace admin has revoked this link." :
             "This share link does not exist."}
          </p>
        </div>
      </div>
    );
  }

  if (!session) return null;
  if (!info.resourceType || !info.resourceId || !info.accessLevel) return null;

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold">
            {info.resourceName || "Shared resource"}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {info.workspaceName}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Without this a hydrated guest kept typing into a dead socket: the
              only connection-derived UI they had was the offline gate, which
              requires an unhydrated replica and so never fires once synced. */}
          {yjsResourceTypeForShare(info.resourceType) !== null && (
            <SyncIndicator state={syncState(doc)} />
          )}
          <span className="text-xs text-muted-foreground">
            Guest: {session.guestName}
          </span>
        </div>
      </header>
      <main className="min-h-0 flex-1">
        {info.resourceType === "document" && (
          <GuestDocumentView
            doc={doc}
            accessLevel={info.accessLevel}
            guestName={session.guestName}
            guestColor={getUserColor(session.guestSub)}
          />
        )}
        {info.resourceType === "diagram" && (
          <GuestDiagramView doc={doc} accessLevel={info.accessLevel} />
        )}
        {info.resourceType === "spreadsheet" && (
          <GuestSpreadsheetView doc={doc} accessLevel={info.accessLevel} />
        )}
        {info.resourceType === "channel" && (
          <GuestCallView
            shareId={shareId}
            guestSub={session.guestSub}
            guestName={session.guestName}
          />
        )}
        {info.resourceType === "calendarEvent" && (
          <GuestEventView
            shareId={shareId}
            guestSub={session.guestSub}
            guestName={session.guestName}
          />
        )}
      </main>
    </div>
  );
}
