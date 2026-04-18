import { RippleSpinner } from "@/components/RippleSpinner";
import { useQuery } from "convex-helpers/react/cache";
import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { loadGuestSession } from "./guestSession";
import { GuestDocumentView } from "./GuestDocumentView";
import { GuestDiagramView } from "./GuestDiagramView";
import { GuestSpreadsheetView } from "./GuestSpreadsheetView";
import { GuestCallView } from "./GuestCallView";

/**
 * Guest resource surface at `/share/:shareId/view`.
 *
 * The entry page (`/share/:shareId`) has already collected a display name
 * and generated a `guestSub`. We re-validate the share here, and dispatch
 * to the right per-resource component. If the share is no longer active
 * or there is no guest session in storage, bounce back to the entry page.
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
        <span className="text-xs text-muted-foreground">
          Guest: {session.guestName}
        </span>
      </header>
      <main className="min-h-0 flex-1">
        {info.resourceType === "document" && (
          <GuestDocumentView
            shareId={shareId}
            guestSub={session.guestSub}
            guestName={session.guestName}
            resourceId={info.resourceId}
            accessLevel={info.accessLevel}
          />
        )}
        {info.resourceType === "diagram" && (
          <GuestDiagramView
            shareId={shareId}
            guestSub={session.guestSub}
            guestName={session.guestName}
            resourceId={info.resourceId}
            accessLevel={info.accessLevel}
          />
        )}
        {info.resourceType === "spreadsheet" && (
          <GuestSpreadsheetView
            shareId={shareId}
            guestSub={session.guestSub}
            guestName={session.guestName}
            resourceId={info.resourceId}
            accessLevel={info.accessLevel}
          />
        )}
        {info.resourceType === "channel" && (
          <GuestCallView
            shareId={shareId}
            guestSub={session.guestSub}
            guestName={session.guestName}
          />
        )}
      </main>
    </div>
  );
}
