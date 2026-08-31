/**
 * Everything the occurrence detail surfaces need, in one hook — the queries,
 * the derived flags, the pending-edit state machine and the handlers.
 *
 * There are two surfaces and one behaviour: `OccurrenceDetailSheet` (the
 * desktop side panel) and `OccurrenceDetailPage` (the mobile destination and
 * the desktop "expand"), exactly as a one-off event has `EventDetailSheet` and
 * `EventDetailPage` over `useEventDetail`. Non-component exports live here so
 * `OccurrenceDetailContent.tsx` stays components-only and Fast Refresh keeps
 * working.
 *
 * ## The one thing this hook is really about
 *
 * Every edit made here is made on **the occurrence in front of the organizer**,
 * and on save they are asked what it applied to. Asking on save rather than
 * before is the whole point: choosing a mode up front asks them to predict what
 * they are about to change. Three kinds of edit reach that question and they
 * are offered different answers:
 *
 *  - **content** (title, description) — any of the three scopes. "This
 *    occurrence" writes an **override**, from which moment the occurrence is a
 *    `calendarEvents` row with its own page.
 *  - **rule** (the recurrence, the anchor time) — the two wider scopes only;
 *    moving one occurrence is a drag on the calendar, not a change to the rule.
 *  - **series** (tags, the roster) — "all occurrences" only, because an
 *    occurrence has no copy of either to change (ADR 0002).
 *
 * The narrower answers are shown disabled rather than withheld — see
 * `edit-scope.ts`.
 */
import { useState } from "react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { RecurrenceRule } from "@ripple/shared/recurrence";

import { getErrorMessage } from "@/lib/errors";
import { useViewer } from "@/pages/App/UserContext";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

import { joinWindowStatus } from "../Dashboard/dashboard-calendar-utils";
import { useJoinStatusTick } from "./useJoinStatusTick";
import { decideNotify } from "./notify-scope";
import type { EditScope } from "./edit-scope";
import { toSeriesDefinition } from "./series-definition";
import { useSeriesRsvp } from "./use-series-rsvp";

/** A change to something only the series holds — one set for the whole ritual. */
export type SeriesOnlyChange =
  | { field: "tags"; tags: string[] }
  | {
      field: "invitees";
      op: "add";
      userIds: Id<"users">[];
      guestEmails: string[];
    }
  | { field: "invitees"; op: "remove"; inviteeId: Id<"eventSeriesInvitees"> }
  | { field: "invitees"; op: "self" };

/**
 * An edit the organizer has finished making but has not yet said the scope of.
 * The kind is what decides which scopes are on offer and whether committing it
 * to the whole series will reset anyone's customised occurrences.
 */
export type PendingEdit =
  | { kind: "content"; fields: { title?: string; description?: string } }
  | { kind: "rule"; fields: { rule?: RecurrenceRule; anchorTime?: string } }
  | { kind: "series"; change: SeriesOnlyChange };

/** "Tuesday, 15 September 2026 · 09:00 – 09:30" */
export function formatOccurrenceWhen(startsAt: number, endsAt: number): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const date = start.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time(start)} – ${time(end)}`;
}

export function useOccurrenceDetail({
  workspaceId,
  seriesId,
  originalStartMs,
  onOverrideCreated,
  onGone,
}: {
  workspaceId: Id<"workspaces">;
  /** `null` while the surface does not yet know which series it is about —
   *  the sheet keeps its place in the tree for one commit after it closes. */
  seriesId: Id<"eventSeries"> | null;
  /**
   * Which occurrence this is, or `null` for the series with none left — the
   * one a bare link lands on when the rule has run out. That surface shows the
   * same fields; only "all occurrences" has anything to mean on it.
   */
  originalStartMs: number | null;
  /**
   * Called instead of navigating when a single-occurrence edit turns this
   * occurrence into an override with an event row of its own. The sheet swaps
   * itself for the event sheet; the page navigates, which is the default.
   */
  onOverrideCreated?: (eventId: Id<"calendarEvents">) => void;
  /** Called when this surface is about what no longer exists: a skipped
   *  occurrence, a deleted series, or one a rule edit moved off this date. */
  onGone?: () => void;
}) {
  const navigate = useNavigate();
  const viewer = useViewer();
  const series = useQuery(api.eventSeries.get, seriesId ? { seriesId } : "skip");
  const channel = useQuery(api.channels.get, series?.channelId ? { id: series.channelId } : "skip");
  // The roster, and the people who could be added to it. Both are the
  // *series'* — there is no per-occurrence roster to ask for (ADR 0002).
  const invitees = useQuery(api.eventSeries.listInvitees, seriesId ? { seriesId } : "skip");
  const members = useQuery(api.workspaceMembers.membersWithRoles, {
    workspaceId,
  });
  // What the confirmation has to state before a rule edit throws customised
  // occurrences away — all of them for "all occurrences", and only the ones a
  // split would reach for "this and following".
  const overridesInSeries = useQuery(
    api.eventSeries.countOverrides,
    seriesId ? { seriesId } : "skip",
  );
  const overridesFollowing = useQuery(
    api.eventSeries.countOverrides,
    seriesId && originalStartMs !== null
      ? { seriesId, fromOriginalStartMs: originalStartMs }
      : "skip",
  );
  // 30s tick, so the Join control appears and disappears on its own — the
  // page a user leaves open on their second monitor is the common case.
  const now = useJoinStatusTick();

  const updateOccurrence = useMutation(api.eventSeries.updateOccurrence);
  const updateFollowing = useMutation(api.eventSeries.updateFollowing);
  const updateSeries = useMutation(api.eventSeries.updateSeries);
  const updateTags = useMutation(api.eventSeries.updateTags);
  const addInvitees = useMutation(api.eventSeries.addInvitees);
  const selfInvite = useMutation(api.eventSeries.selfInvite);
  const removeInvitee = useMutation(api.eventSeries.removeInvitee);
  const cancelOccurrence = useMutation(api.eventSeries.cancelOccurrence);
  const cancelSeries = useMutation(api.eventSeries.cancel);

  // Held across the navigation that follows a skip, so the surface doesn't
  // blink back to the occurrence it just removed.
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

  // The occurrence is where an invitee lands, so it is where they answer —
  // but what they answer is the series, and the same hook the override row
  // uses is what makes it literally the same answer. There is no
  // "not this Tuesday" to give (spec 0003, "Out of Scope").
  const rsvp = useSeriesRsvp({
    seriesId,
    viewerId: viewer?._id,
    organizerId: series?.createdBy,
  });

  const editable = !!viewer && !!series && viewer._id === series.createdBy;
  const calendarHref = `/workspaces/${workspaceId}/dashboard/calendar`;
  // The original start *is* the occurrence's start, and the series carries the
  // one duration every occurrence shares.
  const endsAt = series && originalStartMs !== null ? originalStartMs + series.durationMs : null;
  const callStatus =
    originalStartMs !== null && endsAt !== null
      ? joinWindowStatus(originalStartMs, endsAt, now)
      : "ended";

  /**
   * The roster minus the organizer: who a notification would actually reach.
   * Undefined while the read is in flight, which is treated as "nobody" —
   * the server runs the same decision, so the worst case is a change that
   * goes out silently rather than one that surprises the team.
   */
  const inviteeCount = series
    ? (invitees ?? []).filter((row) => row.userId !== series.createdBy).length
    : 0;

  /** Where the surface goes when what it is about is gone. */
  const leave = () => {
    setSkipped(true);
    if (onGone) onGone();
    else void navigate(calendarHref, { replace: true });
  };

  /**
   * What this edit would tell whom — the scope decides both halves. A single
   * occurrence reaches one date; the wider two reach whatever the rule puts
   * from here on, or all of it.
   */
  const notifyDecisionFor = (scope: EditScope) => {
    if (!series) return { ask: false, summary: "" };
    const definition = toSeriesDefinition(series);
    return decideNotify(
      scope === "occurrence" && originalStartMs !== null
        ? { scope: "occurrence", instants: [originalStartMs] }
        : scope === "following" && originalStartMs !== null
          ? { scope: "following", series: definition, originalStartMs }
          : { scope: "series", series: definition },
      { inviteeCount, nowMs: Date.now() },
    );
  };

  const commit = async (scope: EditScope, edit: PendingEdit, notifyInvitees: boolean) => {
    setPending(null);
    setPendingNotify(null);
    if (!seriesId) return;
    try {
      if (edit.kind === "series") {
        await commitSeriesOnly(edit.change);
        return;
      }
      if (scope === "occurrence" && originalStartMs !== null) {
        // One override, nothing else touched.
        const overrideId = await updateOccurrence({
          seriesId,
          originalStartMs,
          notifyInvitees,
          ...(edit.kind === "content" ? edit.fields : {}),
        });
        if (onOverrideCreated) onOverrideCreated(overrideId);
        else
          void navigate(`/workspaces/${workspaceId}/events/${overrideId}`, {
            replace: true,
          });
        return;
      }
      if (scope === "following" && originalStartMs !== null) {
        const continuationId = await updateFollowing({
          seriesId,
          originalStartMs,
          notifyInvitees,
          ...edit.fields,
        });
        // A rule edit may have moved this occurrence off the coordinate the
        // URL names, so there is no occurrence left to land on.
        if (edit.kind === "rule") leave();
        else
          void navigate(
            `/workspaces/${workspaceId}/events/${continuationId}?on=${originalStartMs}`,
            { replace: true },
          );
        return;
      }
      await updateSeries({ seriesId, notifyInvitees, ...edit.fields });
      if (edit.kind === "rule") leave();
    } catch (err: unknown) {
      toast.error("Could not save", { description: getErrorMessage(err) });
    }
  };

  /**
   * The series-only writes. Each is its own mutation with its own message —
   * `updateTags`, `addInvitees` and friends take no scope, because there is no
   * scope for them to take.
   */
  const commitSeriesOnly = async (change: SeriesOnlyChange) => {
    if (!seriesId) return;
    if (change.field === "tags") {
      try {
        await updateTags({ seriesId, tags: change.tags });
      } catch (err: unknown) {
        toast.error("Could not save the tags", {
          description: getErrorMessage(err),
        });
      }
      return;
    }
    if (change.op === "add") {
      try {
        await addInvitees({
          seriesId,
          userIds: change.userIds,
          guestEmails: change.guestEmails,
        });
        const total = change.userIds.length + change.guestEmails.length;
        toast.success(`Invited ${total} ${total === 1 ? "person" : "people"}`);
      } catch (err: unknown) {
        // The invitee cap arrives here as a `ConvexError` and is said out loud.
        // An add that quietly did nothing is the one outcome an organizer
        // cannot tell apart from success.
        toast.error("Could not add invitees", {
          description: getErrorMessage(err),
        });
      }
      return;
    }
    if (change.op === "remove") {
      try {
        await removeInvitee({ inviteeId: change.inviteeId });
        toast.success("Invitee removed", { duration: 1500 });
      } catch (err: unknown) {
        toast.error("Could not remove invitee", {
          description: getErrorMessage(err),
        });
      }
      return;
    }
    // The organizer joining their own ritual. Silent server-side — nobody is
    // notified, least of all them — so the toast is the only acknowledgement
    // there is, and it is what tells the click apart from a dead button.
    try {
      await selfInvite({ seriesId });
      toast.success("Added you as an invitee", { duration: 1500 });
    } catch (err: unknown) {
      toast.error("Could not add you as invitee", {
        description: getErrorMessage(err),
      });
    }
  };

  const applyScope = (scope: EditScope) => {
    const edit = pending;
    if (!edit) return;
    // A series-only change has no `notifyInvitees` to offer: the roster
    // mutations announce themselves (an invitation is its own notification)
    // and tags reach nobody's plans.
    if (edit.kind === "series") {
      void commit(scope, edit, false);
      return;
    }
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

  const skip = async () => {
    if (!seriesId || originalStartMs === null) return;
    try {
      await cancelOccurrence({ seriesId, originalStartMs });
      leave();
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
    if (!seriesId) return;
    setConfirmingDelete(false);
    try {
      await cancelSeries({ seriesId });
      toast.success("Series deleted");
      leave();
    } catch (err: unknown) {
      toast.error("Could not delete this series", {
        description: getErrorMessage(err),
      });
    }
  };

  const joinCall = () => {
    if (!seriesId || originalStartMs === null) return;
    void navigate(`/workspaces/${workspaceId}/events/${seriesId}/videocall?on=${originalStartMs}`);
  };

  return {
    series,
    channel,
    // A clock that re-renders on its own, so a surface left open across the
    // meeting rolls forward rather than freezing on a date that has passed.
    now,
    invitees,
    members,
    viewer,
    rsvp,
    editable,
    skipped,
    endsAt,
    callStatus,
    originalStartMs,
    overrideCounts: {
      series: overridesInSeries ?? 0,
      following: overridesFollowing ?? 0,
    },
    // The pending-edit machine, as the content component drives it.
    pending,
    setPending,
    pendingNotify,
    setPendingNotify,
    repeatOpen,
    setRepeatOpen,
    confirmingDelete,
    setConfirmingDelete,
    applyScope,
    commit,
    // Handlers. Every one of these *proposes* — nothing is written until the
    // scope question is answered.
    propose: setPending,
    proposeTags: (tags: string[]) =>
      setPending({ kind: "series", change: { field: "tags", tags } }),
    proposeAddInvitees: (userIds: Id<"users">[], guestEmails: string[]) => {
      if (userIds.length === 0 && guestEmails.length === 0) return;
      setPending({
        kind: "series",
        change: { field: "invitees", op: "add", userIds, guestEmails },
      });
    },
    proposeRemoveInvitee: (inviteeId: Id<"eventSeriesInvitees">) =>
      setPending({
        kind: "series",
        change: { field: "invitees", op: "remove", inviteeId },
      }),
    proposeSelfInvite: () =>
      setPending({ kind: "series", change: { field: "invitees", op: "self" } }),
    skip,
    deleteSeries,
    joinCall,
  };
}
