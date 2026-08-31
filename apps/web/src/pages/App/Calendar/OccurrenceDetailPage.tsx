/**
 * Detail surface for one **occurrence** of a series, mounted at
 * `/workspaces/:workspaceId/events/:seriesId?on=<originalStartMs>`.
 *
 * An occurrence has no row of its own — it is computed from the series' rule —
 * so this page is addressed by the (series, original start) pair rather than
 * by an id, and it reads the series rather than an event.
 *
 * Every edit here is made on the occurrence in front of the organizer, and
 * **on save** they are asked what it applied to: this occurrence, this and
 * following, or all occurrences. Asking on save rather than before is the
 * whole point — choosing a mode up front asks the organizer to predict what
 * they are about to change.
 *
 * Two kinds of edit reach that question. A **content** edit — the title, the
 * description — can mean any of the three scopes, and "this occurrence" writes
 * an **override**, from which moment the occurrence is a `calendarEvents` row
 * with its own page, so the save lands the user there. A **rule** edit — the
 * repeat pattern, the start time — belongs to the pattern and so offers only
 * the two wider scopes; moving a single occurrence is a drag on the calendar,
 * which never asks this question at all.
 */
import { useState } from "react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { useNavigate } from "react-router-dom";
import { CalendarX2, Repeat, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { RecurrenceRule } from "@ripple/shared/recurrence";

import { Button } from "@ripple/ui/components/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { RippleSpinner } from "@/components/RippleSpinner";
import { MobileHeaderTitle } from "@/contexts/HeaderSlotContext";
import { getErrorMessage } from "@/lib/errors";
import { useViewer } from "@/pages/App/UserContext";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

import { joinWindowStatus } from "../Dashboard/dashboard-calendar-utils";
import { JoinCallButton } from "./JoinCallButton";
import { useJoinStatusTick } from "./useJoinStatusTick";
import { EditableDescription, EditableTitle } from "./event-detail-blocks";
import { EditScopeDialog } from "./EditScopeDialog";
import { TimeSelect } from "./event-fields";
import { NotifyInviteesDialog } from "./NotifyInviteesDialog";
import { decideNotify } from "./notify-scope";
import { RecurrenceDialog } from "./RecurrenceDialog";
import { describeRule } from "./recurrence-presets";
import type { EditScope } from "./edit-scope";
import { describeOccurrenceInSeries } from "./occurrence-summary";
import { RsvpResponseGroup } from "./RsvpResponseGroup";
import { toSeriesDefinition } from "./series-definition";
import { useSeriesRsvp } from "./use-series-rsvp";

/**
 * An edit the organizer has finished making but has not yet said the scope of.
 * The kind is what decides which scopes are on offer and whether committing it
 * to the whole series will reset anyone's customised occurrences.
 */
type PendingEdit =
  | { kind: "content"; fields: { title?: string; description?: string } }
  | { kind: "rule"; fields: { rule?: RecurrenceRule; anchorTime?: string } };

function formatWhen(startsAt: number, endsAt: number): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const date = start.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const time = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time(start)} – ${time(end)}`;
}

export function OccurrenceDetailPage({
  workspaceId,
  seriesId,
  originalStartMs,
}: {
  workspaceId: Id<"workspaces">;
  seriesId: Id<"eventSeries">;
  originalStartMs: number;
}) {
  const navigate = useNavigate();
  const viewer = useViewer();
  const series = useQuery(api.eventSeries.get, { seriesId });
  // What the confirmation has to state before a rule edit throws customised
  // occurrences away — all of them for "all occurrences", and only the ones a
  // split would reach for "this and following".
  const overridesInSeries = useQuery(api.eventSeries.countOverrides, {
    seriesId,
  });
  const overridesFollowing = useQuery(api.eventSeries.countOverrides, {
    seriesId,
    fromOriginalStartMs: originalStartMs,
  });
  // 30s tick, so the Join control appears and disappears on its own — the
  // page a user leaves open on their second monitor is the common case.
  const now = useJoinStatusTick();
  const updateOccurrence = useMutation(api.eventSeries.updateOccurrence);
  const updateFollowing = useMutation(api.eventSeries.updateFollowing);
  const updateSeries = useMutation(api.eventSeries.updateSeries);
  const cancelOccurrence = useMutation(api.eventSeries.cancelOccurrence);
  const cancelSeries = useMutation(api.eventSeries.cancel);
  // Held across the navigation that follows a skip, so the page doesn't blink
  // back to the occurrence it just removed.
  const [skipped, setSkipped] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, setPending] = useState<PendingEdit | null>(null);
  const [repeatOpen, setRepeatOpen] = useState(false);
  // An edit whose scope is settled and which is now waiting on the second
  // question: does anyone need telling? Held rather than applied so that
  // backing out of the prompt leaves the meeting exactly as it was.
  const [pendingNotify, setPendingNotify] = useState<{
    scope: EditScope;
    edit: PendingEdit;
    summary: string;
  } | null>(null);
  // The roster is the series', so its size is the same on every occurrence —
  // one read, whatever scope the organizer lands on.
  const invitees = useQuery(api.eventSeries.listInvitees, { seriesId });
  // The occurrence is where an invitee lands, so it is where they answer —
  // but what they answer is the series, and the same hook the series page
  // uses is what makes it literally the same answer. There is no
  // "not this Tuesday" to give (spec 0003, "Out of Scope").
  const rsvp = useSeriesRsvp({
    seriesId,
    viewerId: viewer?._id,
    organizerId: series?.createdBy,
  });

  if (series === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <RippleSpinner />
      </div>
    );
  }
  if (series === null || skipped) return <ResourceDeleted resourceType="event" />;

  // The original start *is* the occurrence's start, and the series carries the
  // one duration every occurrence shares.
  const endsAt = originalStartMs + series.durationMs;
  const editable = viewer?._id === series.createdBy;
  const calendarHref = `/workspaces/${workspaceId}/dashboard/calendar`;
  const eventHref = (eventId: Id<"calendarEvents">) =>
    `/workspaces/${series.workspaceId}/events/${eventId}`;
  const occurrenceHref = (id: Id<"eventSeries">, on: number) =>
    `/workspaces/${series.workspaceId}/events/${id}?on=${on}`;
  const rule = series.rule as RecurrenceRule;

  /**
   * The roster minus the organizer: who a notification would actually reach.
   * Undefined while the read is in flight, which is treated as "nobody" —
   * the server runs the same decision, so the worst case is a change that
   * goes out silently rather than one that surprises the team.
   */
  const inviteeCount = (invitees ?? []).filter(
    (row) => row.userId !== series.createdBy,
  ).length;

  const seriesDefinition = toSeriesDefinition(series);

  /**
   * What this edit would tell whom — the scope decides both halves. A single
   * occurrence reaches one date; the wider two reach whatever the rule puts
   * from here on, or all of it.
   */
  const notifyDecisionFor = (scope: EditScope) =>
    decideNotify(
      scope === "occurrence"
        ? { scope, instants: [originalStartMs] }
        : scope === "following"
          ? { scope, series: seriesDefinition, originalStartMs }
          : { scope, series: seriesDefinition },
      { inviteeCount, nowMs: Date.now() },
    );

  const applyScope = (scope: EditScope) => {
    const edit = pending;
    if (!edit) return;
    const decision = notifyDecisionFor(scope);
    if (decision.ask) {
      // Ask before writing, so declining the *question* is not the same as
      // declining the *edit* — the prompt's own "Don't send" applies it.
      setPending(null);
      setPendingNotify({ scope, edit, summary: decision.summary });
      return;
    }
    void commit(scope, edit, false);
  };

  const commit = async (
    scope: EditScope,
    edit: PendingEdit,
    notifyInvitees: boolean,
  ) => {
    setPending(null);
    setPendingNotify(null);
    try {
      if (scope === "occurrence") {
        // Ticket 04's path exactly: one override, nothing else touched.
        const overrideId = await updateOccurrence({
          seriesId,
          originalStartMs,
          notifyInvitees,
          ...(edit.kind === "content" ? edit.fields : {}),
        });
        void navigate(eventHref(overrideId), { replace: true });
        return;
      }
      if (scope === "following") {
        const continuationId = await updateFollowing({
          seriesId,
          originalStartMs,
          notifyInvitees,
          ...edit.fields,
        });
        // A rule edit may have moved this occurrence off the coordinate the
        // URL names, so there is no occurrence left to land on.
        void navigate(
          edit.kind === "rule"
            ? calendarHref
            : occurrenceHref(continuationId, originalStartMs),
          { replace: true },
        );
        return;
      }
      await updateSeries({ seriesId, notifyInvitees, ...edit.fields });
      if (edit.kind === "rule") void navigate(calendarHref, { replace: true });
    } catch (err: unknown) {
      toast.error("Could not save", { description: getErrorMessage(err) });
    }
  };

  const skip = async () => {
    try {
      await cancelOccurrence({ seriesId, originalStartMs });
      setSkipped(true);
      void navigate(calendarHref, { replace: true });
    } catch (err: unknown) {
      toast.error("Could not skip this occurrence", {
        description: getErrorMessage(err),
      });
    }
  };

  /**
   * Delete the whole series — one action, not fifty-two. Confirmed the same
   * way a one-off event's cancellation is, and for the stronger reason: every
   * occurrence goes, past ones included.
   */
  const deleteSeries = async () => {
    setConfirmingDelete(false);
    try {
      await cancelSeries({ seriesId });
      setSkipped(true);
      toast.success("Series deleted");
      void navigate(`/workspaces/${series.workspaceId}/dashboard/calendar`, {
        replace: true,
      });
    } catch (err: unknown) {
      toast.error("Could not delete this series", {
        description: getErrorMessage(err),
      });
    }
  };

  // Every occurrence meets in the same room, but only during its own window:
  // the control is offered from five minutes before this occurrence until
  // fifteen after it, and not at all on the other fifty-one Tuesdays. The
  // server applies the same rule, so a hand-typed URL gains nothing.
  const callStatus = joinWindowStatus(originalStartMs, endsAt, now);
  const joinCall = () => {
    void navigate(
      `/workspaces/${workspaceId}/events/${seriesId}/videocall?on=${originalStartMs}`,
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {editable && (
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void skip()}
            title="Skip this occurrence"
          >
            <CalendarX2 className="mr-1.5 h-4 w-4 text-destructive" />
            Skip this occurrence
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmingDelete(true)}
            title="Delete series"
          >
            <Trash2 className="mr-1.5 h-4 w-4 text-destructive" />
            Delete series
          </Button>
        </div>
      )}
      <MobileHeaderTitle name={series.title} />
      <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 py-6">
        {editable ? (
          <EditableTitle
            value={series.title}
            onSave={(title) => setPending({ kind: "content", fields: { title } })}
            size="lg"
          />
        ) : (
          <h1 className="text-2xl font-semibold">{series.title}</h1>
        )}
        <p className="mt-2 text-sm text-muted-foreground">
          {formatWhen(originalStartMs, endsAt)}
        </p>
        {/* What a viewer has to know before anything else on this page makes
            sense: that this repeats, how much of it is left, and where to go
            to change the pattern — so an organizer who notices a problem on a
            Tuesday can fix it from where they noticed it. */}
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Repeat className="h-3.5 w-3.5 shrink-0" />
            {describeOccurrenceInSeries(
              toSeriesDefinition(series),
              originalStartMs,
            )}
          </span>
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() =>
              void navigate(
                `/workspaces/${series.workspaceId}/events/${seriesId}/series`,
              )
            }
          >
            View series
          </button>
        </p>
        <JoinCallButton
          status={callStatus}
          onJoin={joinCall}
          className="mt-6 min-w-40"
          pendingClassName="mt-6"
        />
        {rsvp && (
          <RsvpResponseGroup
            myStatus={rsvp.myStatus}
            onRespond={(status) => void rsvp.respond(status)}
            className="mt-6 max-w-md"
            buttonClassName="flex-1"
          />
        )}
        <div className="mt-6">
          {editable ? (
            <EditableDescription
              value={series.description ?? ""}
              rows={6}
              onSave={(description) =>
                setPending({ kind: "content", fields: { description } })
              }
            />
          ) : series.description ? (
            <p className="whitespace-pre-wrap text-sm">{series.description}</p>
          ) : null}
        </div>

        {/* The pattern itself. Both controls here are rule edits, so both go
            through the same on-save question as a rename does. */}
        <div className="mt-8 flex flex-col gap-3 border-t pt-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Repeat className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-sm">
              {describeRule(rule, new Date(originalStartMs))}
            </span>
            {editable && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRepeatOpen(true)}
              >
                Change repeat
              </Button>
            )}
          </div>
          {editable && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted-foreground">
                Starts at ({series.timezone})
              </span>
              <TimeSelect
                // Show the picked time while the scope question is open —
                // the series row still holds the old one until it is answered.
                value={
                  (pending?.kind === "rule" ? pending.fields.anchorTime : undefined) ??
                  series.anchorTime
                }
                onChange={(anchorTime) => {
                  if (!anchorTime || anchorTime === series.anchorTime) return;
                  setPending({ kind: "rule", fields: { anchorTime } });
                }}
                triggerClassName="w-32"
              />
            </div>
          )}
        </div>
      </div>

      {repeatOpen && (
        <RecurrenceDialog
          open
          onOpenChange={setRepeatOpen}
          date={new Date(originalStartMs)}
          anchor={{
            date: series.anchorDate,
            time: series.anchorTime,
            timezone: series.timezone,
            durationMs: series.durationMs,
          }}
          initialRule={rule}
          onConfirm={(next) => {
            setRepeatOpen(false);
            setPending({ kind: "rule", fields: { rule: next } });
          }}
        />
      )}

      {pending && (
        <EditScopeDialog
          open
          onOpenChange={(next) => {
            if (!next) setPending(null);
          }}
          kind={pending.kind}
          overrideCounts={{
            series: overridesInSeries ?? 0,
            following: overridesFollowing ?? 0,
          }}
          onConfirm={applyScope}
        />
      )}

      {/* The second question, and only when its answer is not already known:
          the edit reaches somebody's future and there is somebody to tell. */}
      {pendingNotify && (
        <NotifyInviteesDialog
          open
          onOpenChange={(next) => {
            if (!next) setPendingNotify(null);
          }}
          eventTitle={series.title}
          summary={pendingNotify.summary}
          onChoose={(choice) => {
            if (choice === "revert") {
              // Backing out of the question backs out of the edit: nothing
              // has been written yet.
              setPendingNotify(null);
              return;
            }
            void commit(
              pendingNotify.scope,
              pendingNotify.edit,
              choice === "send",
            );
          }}
        />
      )}
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        onConfirm={() => void deleteSeries()}
        title="Delete this series?"
        description="Every occurrence will be removed, past ones included. This cannot be undone."
        confirmLabel="Delete series"
        dismissLabel="Keep series"
      />
    </div>
  );
}
