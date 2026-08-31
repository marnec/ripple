/**
 * Full-page detail surface for one **occurrence** of a series, mounted at
 * `/workspaces/:workspaceId/events/:seriesId?on=<originalStartMs>`.
 *
 * An occurrence has no row of its own — it is computed from the series' rule —
 * so this page is addressed by the (series, original start) pair rather than
 * by an id, and it reads the series rather than an event.
 *
 * The mobile destination for an occurrence tap and the desktop "expand from
 * sheet" target, exactly as `EventDetailPage` is for a one-off event. The
 * content is `OccurrenceDetailContent`, shared verbatim with the sheet; what
 * differs is layout (a wider column, a larger title) and where the destructive
 * actions sit.
 *
 * `originalStartMs === null` is the series with no occurrence left, which a
 * bare `/events/:seriesId` link resolves to once the rule has run out. It is
 * the same surface with no date under it — this is what replaced the separate
 * `/events/:id/series` page.
 */
import { Trash2, CalendarX2 } from "lucide-react";

import { Button } from "@ripple/ui/components/button";
import { RippleSpinner } from "@/components/RippleSpinner";
import { HeaderSlot, MobileHeaderTitle } from "@/contexts/HeaderSlotContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import type { Id } from "@convex/_generated/dataModel";

import { EditableTitle } from "./event-detail-blocks";
import { JoinCallButton } from "./JoinCallButton";
import { OccurrenceDetailContent, OccurrenceDetailDialogs } from "./OccurrenceDetailContent";
import { RsvpResponseGroup } from "./RsvpResponseGroup";
import { useOccurrenceDetail } from "./occurrence-detail-data";

export function OccurrenceDetailPage({
  workspaceId,
  seriesId,
  originalStartMs,
}: {
  workspaceId: Id<"workspaces">;
  seriesId: Id<"eventSeries">;
  originalStartMs: number | null;
}) {
  const isMobile = useIsMobile();
  const detail = useOccurrenceDetail({ workspaceId, seriesId, originalStartMs });
  const {
    series,
    skipped,
    editable,
    rsvp,
    callStatus,
    joinCall,
    skip,
    setConfirmingDelete,
    propose,
  } = detail;

  if (series === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <RippleSpinner />
      </div>
    );
  }
  if (series === null || skipped) return <ResourceDeleted resourceType="event" />;

  // Destructive actions, as both event surfaces place them: a desktop toolbar
  // of its own, and the global header on mobile so the app's chrome stays in
  // charge of chrome. "Skip" needs a date to skip, so it is absent on the
  // series with none left.
  const actions = (
    <>
      {originalStartMs !== null && (
        <Button
          variant="ghost"
          size={isMobile ? "icon" : "sm"}
          onClick={() => void skip()}
          title="Skip this occurrence"
          aria-label="Skip this occurrence"
        >
          <CalendarX2 className="size-4 text-destructive md:mr-1.5" />
          {!isMobile && "Skip this occurrence"}
        </Button>
      )}
      <Button
        variant="ghost"
        size={isMobile ? "icon" : "sm"}
        onClick={() => setConfirmingDelete(true)}
        title="Delete series"
        aria-label="Delete series"
      >
        <Trash2 className="size-4 text-destructive md:mr-1.5" />
        {!isMobile && "Delete series"}
      </Button>
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {editable && !isMobile && (
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">{actions}</div>
      )}
      {editable && isMobile && <HeaderSlot>{actions}</HeaderSlot>}
      <MobileHeaderTitle name={series.title} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-4 md:px-8 md:pt-8">
          {editable ? (
            <EditableTitle
              value={series.title}
              size="lg"
              onSave={(title) => propose({ kind: "content", fields: { title } })}
            />
          ) : (
            <h1 className="truncate text-2xl font-semibold tracking-tight">{series.title}</h1>
          )}
          <div className="h-6" />

          <OccurrenceDetailContent
            detail={{ ...detail, series }}
            workspaceId={workspaceId}
            gapClassName="gap-7"
            descriptionRows={6}
          />

          {/* Footer actions (Join + RSVP) — kept in the body, not a sticky
              bar: the page already scrolls and a fixed bar would chew
              vertical space on mobile. */}
          <div className="mt-10 flex flex-col gap-2 border-t pt-6">
            <JoinCallButton status={callStatus} onJoin={joinCall} className="min-w-40 self-start" />
            {rsvp && (
              <RsvpResponseGroup
                myStatus={rsvp.myStatus}
                onRespond={(status) => void rsvp.respond(status)}
                className="max-w-md"
                buttonClassName="flex-1"
              />
            )}
          </div>
        </div>
      </div>
      <OccurrenceDetailDialogs detail={{ ...detail, series }} />
    </div>
  );
}
