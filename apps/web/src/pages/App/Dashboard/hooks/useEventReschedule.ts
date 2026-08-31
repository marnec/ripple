import { useState } from "react";
import { Temporal } from "temporal-polyfill";
import { toast } from "sonner";

import { getErrorMessage } from "@/lib/errors";
import type { Id } from "@convex/_generated/dataModel";

import {
  msToZonedDateTime,
  temporalToMs,
} from "../../Calendar/event-time-utils";
import { decideNotify } from "../../Calendar/notify-scope";
import { parseScheduleXEventId } from "../../Calendar/scheduleXEventId";

/**
 * The narrow event shape this hook reads off the events query result.
 * Declared structurally rather than as `Doc<"calendarEvents">` so tests
 * can fabricate the minimum surface they need without seeding a full
 * Convex document.
 */
export type ReschedulableEvent = {
  _id: Id<"calendarEvents">;
  startsAt: number;
  endsAt: number;
  title: string;
  /**
   * Number of invitees other than the organizer. When 0 we silent-write;
   * when > 0 we stage the notify-invitees dialog (unless the edit is
   * historical — see `affectsOnlyThePast`).
   */
  nonOrganizerInviteeCount: number;
};

/**
 * The narrow shape this hook reads off the series-occurrences query result.
 * An occurrence has no row, so it is named by the (series, original start)
 * pair — the original start is the coordinate an override is filed under, and
 * it does not move when the occurrence does.
 */
export type ReschedulableOccurrence = {
  seriesId: Id<"eventSeries">;
  originalStartMs: number;
  startsAt: number;
  endsAt: number;
  title: string;
  /**
   * The **series'** roster, minus the organizer — stamped on every occurrence
   * the rule produces, because everyone invited to the standup is invited to
   * all of it. Drives the same silent-vs-prompted branch a one-off event's
   * invitee count does.
   */
  nonOrganizerInviteeCount: number;
};

/**
 * Snapshot of a schedule-x event we'll restore on revert. Matches the
 * subset of `CalendarEventExternal` schedule-x's `events.update` accepts.
 */
export type RescheduleSnapshot = {
  id: string;
  start: Temporal.PlainDate | Temporal.ZonedDateTime;
  end: Temporal.PlainDate | Temporal.ZonedDateTime;
  title: string;
  calendarId: string;
};

/**
 * Stage of an in-flight reschedule waiting on the user's notify-or-not
 * choice. The parent reads this to mount `<NotifyInviteesDialog />`.
 */
export type RescheduleAttempt = {
  /**
   * What is being moved. An occurrence has no row until this write makes one,
   * so it is named by the (series, original start) pair rather than by an id —
   * and it goes to a different mutation.
   */
  target:
    | { kind: "event"; eventId: Id<"calendarEvents"> }
    | {
        kind: "occurrence";
        seriesId: Id<"eventSeries">;
        originalStartMs: number;
      };
  /** Original schedule-x event we can restore on a revert. */
  original: RescheduleSnapshot;
  oldStartsAt: number;
  oldEndsAt: number;
  newStartsAt: number;
  newEndsAt: number;
  title: string;
  inviteeCount: number;
  /** "2 invitees, this occurrence" — what the prompt says it will send. */
  summary: string;
};

/**
 * Minimum surface this hook needs from the schedule-x calendar app.
 * Method-signature syntax (`update(e): void`) is used deliberately:
 * TypeScript treats method parameters as bivariant, so the wide
 * schedule-x `events.update(e: CalendarEventExternal)` is assignable
 * to this narrow `update(e: RescheduleSnapshot)` without a cast.
 */
export type CalendarAppRescheduleHandle = {
  events: {
    update(event: RescheduleSnapshot): void;
  };
};

/** Convex `calendarEvents.update` mutation signature, narrowed for the
 *  cases this hook drives. Accepting the mutation as an argument keeps
 *  the hook independent of `useMutation` so tests can inject a stub. */
export type UpdateEventMutation = (args: {
  eventId: Id<"calendarEvents">;
  startsAt: number;
  endsAt: number;
  notifyInvitees: boolean;
}) => Promise<unknown>;

/** Convex `eventSeries.updateOccurrence` handle, narrowed to the drag/resize
 *  case. Injected for the same reason `updateEvent` is. */
export type OverrideOccurrenceMutation = (args: {
  seriesId: Id<"eventSeries">;
  originalStartMs: number;
  startsAt: number;
  endsAt: number;
  notifyInvitees: boolean;
}) => Promise<unknown>;

export type UseEventRescheduleArgs = {
  /** Events list from `api.calendarEvents.listMineInRange`. May be undefined while loading. */
  events: ReschedulableEvent[] | undefined;
  /** Occurrences list from `api.eventSeries.listMineInRange`. May be undefined while loading. */
  occurrences: ReschedulableOccurrence[] | undefined;
  /** Convex `calendarEvents.update` handle. */
  updateEvent: UpdateEventMutation;
  /** Convex `eventSeries.updateOccurrence` handle. */
  overrideOccurrence: OverrideOccurrenceMutation;
  /** Schedule-x calendar app — used only to roll back the visual on revert. */
  calendarApp: CalendarAppRescheduleHandle;
  /** Schedule-x `calendarId` of the dashboard's event lane. Stamped on the
   *  revert snapshot so the styling lane is preserved when we replay it. */
  eventCalendarId: string;
  /** Clock injection. Defaults to `Date.now`; tests pin it for the
   *  historical-edit predicate. */
  now?: () => number;
};

export type UseEventRescheduleResult = {
  /** Currently-staged attempt; non-null while the notify-invitees dialog is open. */
  pendingReschedule: RescheduleAttempt | null;
  /**
   * Wire this into the schedule-x `onEventUpdate` callback (via the
   * caller's `onEventUpdateRef` trampoline — see MyCalendarTab). Decides
   * silent-vs-prompted dispatch based on invitee count + historical-edit
   * predicate.
   */
  handleEventUpdate: (updated: {
    id: string | number;
    start: unknown;
    end: unknown;
  }) => void;
  /** Persist the staged attempt and notify guests. */
  sendReschedule: () => void;
  /** Persist the staged attempt without notifying guests. */
  persistSilently: () => void;
  /** Roll the schedule-x visual back to the original snapshot. */
  revertReschedule: () => void;
};

/**
 * Owns the dashboard calendar's reschedule decision flow + modal staging.
 *
 * Responsibilities:
 *   - Decide between silent persist and the notify-invitees prompt based
 *     on (a) invitee count and (b) the `affectsOnlyThePast` predicate
 *     (past → past edits are organizer history-cleanup, never prompted).
 *   - Stage the modal state + a snapshot of the original schedule-x event
 *     so the "Revert" button can roll back without a refetch.
 *   - On send/silent persist failure, restore the visual + surface the
 *     error via toast so the calendar stays truthful with the server.
 *
 * Stays out of scope:
 *   - The `onEventUpdateRef` ref trampoline. The schedule-x drag/resize
 *     plugin's callback registry captures its callback at plugin
 *     construction time (inside `createCalendar`'s lazy initializer), so
 *     replacing the ref with a hook return value would break the
 *     fresh-state read pattern. The caller threads `handleEventUpdate`
 *     through its own `onEventUpdateRef.current = …` wiring.
 */
export function useEventReschedule({
  events,
  occurrences,
  updateEvent,
  overrideOccurrence,
  calendarApp,
  eventCalendarId,
  now = () => Date.now(),
}: UseEventRescheduleArgs): UseEventRescheduleResult {
  const [pendingReschedule, setPendingReschedule] =
    useState<RescheduleAttempt | null>(null);

  /**
   * A drag or resize on one occurrence of a series. It always writes an
   * override for that occurrence alone and never edits the rule, so there is
   * no **scope** to ask about — the cheapest gesture on the calendar stays the
   * one with the smallest blast radius (ADR 0002).
   *
   * The "notify invitees?" question is a different one and is still asked,
   * exactly as it is for a one-off event: next Tuesday moving is next
   * Tuesday moving, whether or not it is part of a pattern.
   */
  function handleOccurrenceUpdate(
    id: string,
    parsed: { seriesId: Id<"eventSeries">; originalStartMs: number },
    updated: { start: unknown; end: unknown },
  ): void {
    const source = occurrences?.find(
      (o) =>
        o.seriesId === parsed.seriesId &&
        o.originalStartMs === parsed.originalStartMs,
    );
    if (!source) return;

    const startsAt = temporalToMs(updated.start);
    const endsAt = temporalToMs(updated.end);
    if (startsAt === source.startsAt && endsAt === source.endsAt) return;

    const decision = decideNotify(
      { scope: "occurrence", instants: [source.startsAt, startsAt] },
      { inviteeCount: source.nonOrganizerInviteeCount, nowMs: now() },
    );
    if (!decision.ask) {
      void overrideOccurrence({
        seriesId: parsed.seriesId,
        originalStartMs: parsed.originalStartMs,
        startsAt,
        endsAt,
        notifyInvitees: false,
      }).catch((err: unknown) => {
        toast.error("Could not reschedule", {
          description: getErrorMessage(err),
        });
      });
      return;
    }

    setPendingReschedule({
      target: {
        kind: "occurrence",
        seriesId: parsed.seriesId,
        originalStartMs: parsed.originalStartMs,
      },
      original: {
        id,
        start: msToZonedDateTime(source.startsAt),
        end: msToZonedDateTime(source.endsAt),
        title: source.title,
        calendarId: eventCalendarId,
      },
      oldStartsAt: source.startsAt,
      oldEndsAt: source.endsAt,
      newStartsAt: startsAt,
      newEndsAt: endsAt,
      title: source.title,
      inviteeCount: source.nonOrganizerInviteeCount,
      summary: decision.summary,
    });
  }

  function handleEventUpdate(updated: {
    id: string | number;
    start: unknown;
    end: unknown;
  }): void {
    const id = String(updated.id);
    const parsed = parseScheduleXEventId(id);
    if (parsed?.kind === "occurrence") {
      handleOccurrenceUpdate(id, parsed, updated);
      return;
    }
    if (parsed?.kind !== "event") return; // tasks blocked at onBeforeEventUpdate
    const eventId = parsed.id;
    const sourceEvent = events?.find((e) => e._id === eventId);
    if (!sourceEvent) return;

    // Schedule-x emits start/end as Temporal types; convert to ms.
    const newStartsAt = temporalToMs(updated.start);
    const newEndsAt = temporalToMs(updated.end);
    if (
      newStartsAt === sourceEvent.startsAt &&
      newEndsAt === sourceEvent.endsAt
    ) {
      return; // no-op (drag aborted or returned to original cell)
    }

    const inviteeCount = sourceEvent.nonOrganizerInviteeCount;
    // Nobody to tell, or a past→past edit that is organizer history-cleanup
    // rather than a real schedule change: both mean write straight through.
    // The server runs the very same decision as a safety net for the edit
    // paths that are not this one — `decideNotify` and the mutation both
    // reach the shared recurrence module, which is why there is no client
    // copy of the rule to drift.
    const decision = decideNotify(
      { scope: "occurrence", instants: [sourceEvent.startsAt, newStartsAt] },
      { inviteeCount, nowMs: now() },
    );
    // No external eyes on the event → just write through. The organizer's
    // own calendar updates reactively from convex.
    if (!decision.ask) {
      void updateEvent({
        eventId,
        startsAt: newStartsAt,
        endsAt: newEndsAt,
        notifyInvitees: false,
      }).catch((err: unknown) => {
        toast.error("Could not reschedule", {
          description: getErrorMessage(err),
        });
      });
      return;
    }

    // Has guests → ask. Stage the reschedule details + a snapshot of the
    // original event so a "Revert" action can roll the visual back without
    // a refetch.
    setPendingReschedule({
      target: { kind: "event", eventId },
      original: {
        id,
        start: msToZonedDateTime(sourceEvent.startsAt),
        end: msToZonedDateTime(sourceEvent.endsAt),
        title: sourceEvent.title,
        calendarId: eventCalendarId,
      },
      oldStartsAt: sourceEvent.startsAt,
      oldEndsAt: sourceEvent.endsAt,
      newStartsAt,
      newEndsAt,
      title: sourceEvent.title,
      inviteeCount,
      summary: decision.summary,
    });
  }

  /**
   * Shared persistence path for `sendReschedule` / `persistSilently`. On
   * mutation failure, restore the visual so the calendar stays truthful
   * with the server, then surface the error.
   */
  function persist(notifyInvitees: boolean) {
    const attempt = pendingReschedule;
    if (!attempt) return;
    setPendingReschedule(null);
    const write =
      attempt.target.kind === "event"
        ? updateEvent({
            eventId: attempt.target.eventId,
            startsAt: attempt.newStartsAt,
            endsAt: attempt.newEndsAt,
            notifyInvitees,
          })
        : overrideOccurrence({
            seriesId: attempt.target.seriesId,
            originalStartMs: attempt.target.originalStartMs,
            startsAt: attempt.newStartsAt,
            endsAt: attempt.newEndsAt,
            notifyInvitees,
          });
    void write.catch((err: unknown) => {
      try {
        calendarApp.events.update(attempt.original);
      } catch {
        /* noop — the diff effect will re-sync on the next events query update */
      }
      toast.error("Could not reschedule", {
        description: getErrorMessage(err),
      });
    });
  }

  function sendReschedule(): void {
    persist(true);
  }

  function persistSilently(): void {
    persist(false);
  }

  function revertReschedule(): void {
    const attempt = pendingReschedule;
    if (!attempt) return;
    setPendingReschedule(null);
    try {
      calendarApp.events.update(attempt.original);
    } catch {
      // If schedule-x rejects the manual update (event removed in the
      // meantime, etc.), the diff effect will re-sync on the next events
      // query update — at worst a brief visual lag.
    }
  }

  return {
    pendingReschedule,
    handleEventUpdate,
    sendReschedule,
    persistSilently,
    revertReschedule,
  };
}
