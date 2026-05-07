import { useState } from "react";
import { Temporal } from "temporal-polyfill";
import { toast } from "sonner";

import { isHistoricalReschedule } from "@/lib/calendar-utils";
import { getErrorMessage } from "@/lib/errors";
import type { Id } from "@convex/_generated/dataModel";

import {
  msToZonedDateTime,
  temporalToMs,
} from "../../Calendar/event-time-utils";
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
   * historical — see `isHistoricalReschedule`).
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
  eventId: Id<"calendarEvents">;
  /** Original schedule-x event we can restore on a revert. */
  original: RescheduleSnapshot;
  oldStartsAt: number;
  oldEndsAt: number;
  newStartsAt: number;
  newEndsAt: number;
  title: string;
  inviteeCount: number;
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

export type UseEventRescheduleArgs = {
  /** Events list from `api.calendarEvents.listMineInRange`. May be undefined while loading. */
  events: ReschedulableEvent[] | undefined;
  /** Convex `calendarEvents.update` handle. */
  updateEvent: UpdateEventMutation;
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
 *     on (a) invitee count and (b) the `isHistoricalReschedule` predicate
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
  updateEvent,
  calendarApp,
  eventCalendarId,
  now = () => Date.now(),
}: UseEventRescheduleArgs): UseEventRescheduleResult {
  const [pendingReschedule, setPendingReschedule] =
    useState<RescheduleAttempt | null>(null);

  function handleEventUpdate(updated: {
    id: string | number;
    start: unknown;
    end: unknown;
  }): void {
    const id = String(updated.id);
    const parsed = parseScheduleXEventId(id);
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
    // Past→past edits are organizer history-cleanup, not real schedule
    // changes — silent write regardless of invitee count. Server applies
    // the same predicate as a safety net for non-dashboard edit paths.
    const historical = isHistoricalReschedule(
      sourceEvent.startsAt,
      newStartsAt,
      now(),
    );
    // No external eyes on the event → just write through. The organizer's
    // own calendar updates reactively from convex.
    if (inviteeCount === 0 || historical) {
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
      eventId,
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
    void updateEvent({
      eventId: attempt.eventId,
      startsAt: attempt.newStartsAt,
      endsAt: attempt.newEndsAt,
      notifyInvitees,
    }).catch((err: unknown) => {
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
