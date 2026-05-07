import { act, renderHook } from "@testing-library/react";
import { Temporal } from "temporal-polyfill";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Id } from "@convex/_generated/dataModel";

import {
  useEventReschedule,
  type ReschedulableEvent,
  type CalendarAppRescheduleHandle,
  type UpdateEventMutation,
} from "./useEventReschedule";

// Mock sonner so the hook's failure-path toasts don't blow up in jsdom.
vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

const EVENT_CAL_ID = "event";
const FIXED_NOW = new Date("2026-05-04T12:00:00Z").getTime();

const PAST_START = new Date("2026-04-01T09:00:00Z").getTime();
const PAST_END = new Date("2026-04-01T10:00:00Z").getTime();
const FUTURE_START = new Date("2026-06-15T09:00:00Z").getTime();
const FUTURE_END = new Date("2026-06-15T10:00:00Z").getTime();

const EVENT_ID = "ev_aaaa" as Id<"calendarEvents">;

function makeEvent(
  overrides: Partial<ReschedulableEvent> = {},
): ReschedulableEvent {
  return {
    _id: EVENT_ID,
    startsAt: FUTURE_START,
    endsAt: FUTURE_END,
    title: "Sync",
    nonOrganizerInviteeCount: 0,
    ...overrides,
  };
}

/**
 * Build a calendar-app stub with a spy on `events.update`. The
 * reschedule hook only ever calls `events.update(...)` on the revert
 * path or on persist-failure rollback.
 */
function makeCalendarApp(): CalendarAppRescheduleHandle & {
  updateSpy: ReturnType<typeof vi.fn>;
} {
  const updateSpy = vi.fn();
  return {
    events: { update: updateSpy },
    updateSpy,
  };
}

/** Schedule-x emits start/end as Temporal types; the hook converts to
 *  ms via `temporalToMs`. We seed inputs the way the drag/resize plugin
 *  would — `Temporal.Instant` so `temporalToMs` reads `.epochMilliseconds`. */
function instant(ms: number): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(ms);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useEventReschedule.handleEventUpdate", () => {
  it("is a no-op when start and end are unchanged", () => {
    const updateEvent = vi.fn(() => Promise.resolve());
    const calendarApp = makeCalendarApp();
    const { result } = renderHook(() =>
      useEventReschedule({
        events: [makeEvent({ nonOrganizerInviteeCount: 5 })],
        updateEvent,
        calendarApp,
        eventCalendarId: EVENT_CAL_ID,
        now: () => FIXED_NOW,
      }),
    );

    act(() => {
      result.current.handleEventUpdate({
        id: `event-${EVENT_ID}`,
        start: instant(FUTURE_START),
        end: instant(FUTURE_END),
      });
    });

    expect(updateEvent).not.toHaveBeenCalled();
    expect(result.current.pendingReschedule).toBeNull();
  });

  it("is a no-op for task ids (tasks are blocked at onBeforeEventUpdate)", () => {
    const updateEvent = vi.fn(() => Promise.resolve());
    const calendarApp = makeCalendarApp();
    const { result } = renderHook(() =>
      useEventReschedule({
        events: [makeEvent({ nonOrganizerInviteeCount: 5 })],
        updateEvent,
        calendarApp,
        eventCalendarId: EVENT_CAL_ID,
        now: () => FIXED_NOW,
      }),
    );

    act(() => {
      result.current.handleEventUpdate({
        id: "task-jh7abc",
        start: instant(FUTURE_START + 60 * 60 * 1000),
        end: instant(FUTURE_END + 60 * 60 * 1000),
      });
    });

    expect(updateEvent).not.toHaveBeenCalled();
    expect(result.current.pendingReschedule).toBeNull();
  });

  it("is a no-op when the source event is not in the events array", () => {
    const updateEvent = vi.fn(() => Promise.resolve());
    const calendarApp = makeCalendarApp();
    const { result } = renderHook(() =>
      useEventReschedule({
        events: [],
        updateEvent,
        calendarApp,
        eventCalendarId: EVENT_CAL_ID,
        now: () => FIXED_NOW,
      }),
    );

    act(() => {
      result.current.handleEventUpdate({
        id: `event-${EVENT_ID}`,
        start: instant(FUTURE_START + 60 * 60 * 1000),
        end: instant(FUTURE_END + 60 * 60 * 1000),
      });
    });

    expect(updateEvent).not.toHaveBeenCalled();
    expect(result.current.pendingReschedule).toBeNull();
  });

  it("silent-persists when invitee count is zero (no dialog stage)", () => {
    const updateEvent = vi.fn(() => Promise.resolve());
    const calendarApp = makeCalendarApp();
    const newStart = FUTURE_START + 60 * 60 * 1000;
    const newEnd = FUTURE_END + 60 * 60 * 1000;
    const { result } = renderHook(() =>
      useEventReschedule({
        events: [makeEvent({ nonOrganizerInviteeCount: 0 })],
        updateEvent,
        calendarApp,
        eventCalendarId: EVENT_CAL_ID,
        now: () => FIXED_NOW,
      }),
    );

    act(() => {
      result.current.handleEventUpdate({
        id: `event-${EVENT_ID}`,
        start: instant(newStart),
        end: instant(newEnd),
      });
    });

    expect(updateEvent).toHaveBeenCalledTimes(1);
    expect(updateEvent).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      startsAt: newStart,
      endsAt: newEnd,
      notifyInvitees: false,
    });
    expect(result.current.pendingReschedule).toBeNull();
  });

  it("silent-persists for historical edits (past → past) even with guests", () => {
    const updateEvent = vi.fn(() => Promise.resolve());
    const calendarApp = makeCalendarApp();
    const newStart = PAST_START + 30 * 60 * 1000; // still in the past
    const newEnd = PAST_END + 30 * 60 * 1000;
    const { result } = renderHook(() =>
      useEventReschedule({
        events: [
          makeEvent({
            startsAt: PAST_START,
            endsAt: PAST_END,
            nonOrganizerInviteeCount: 5,
          }),
        ],
        updateEvent,
        calendarApp,
        eventCalendarId: EVENT_CAL_ID,
        now: () => FIXED_NOW,
      }),
    );

    act(() => {
      result.current.handleEventUpdate({
        id: `event-${EVENT_ID}`,
        start: instant(newStart),
        end: instant(newEnd),
      });
    });

    expect(updateEvent).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      startsAt: newStart,
      endsAt: newEnd,
      notifyInvitees: false,
    });
    expect(result.current.pendingReschedule).toBeNull();
  });

  it("stages pendingReschedule with the correct shape when guests are present and the edit is in the future", () => {
    const updateEvent = vi.fn(() => Promise.resolve());
    const calendarApp = makeCalendarApp();
    const newStart = FUTURE_START + 60 * 60 * 1000;
    const newEnd = FUTURE_END + 60 * 60 * 1000;
    const { result } = renderHook(() =>
      useEventReschedule({
        events: [
          makeEvent({
            title: "Quarterly review",
            nonOrganizerInviteeCount: 3,
          }),
        ],
        updateEvent,
        calendarApp,
        eventCalendarId: EVENT_CAL_ID,
        now: () => FIXED_NOW,
      }),
    );

    act(() => {
      result.current.handleEventUpdate({
        id: `event-${EVENT_ID}`,
        start: instant(newStart),
        end: instant(newEnd),
      });
    });

    expect(updateEvent).not.toHaveBeenCalled();
    const pending = result.current.pendingReschedule;
    expect(pending).not.toBeNull();
    expect(pending?.eventId).toBe(EVENT_ID);
    expect(pending?.title).toBe("Quarterly review");
    expect(pending?.inviteeCount).toBe(3);
    expect(pending?.oldStartsAt).toBe(FUTURE_START);
    expect(pending?.oldEndsAt).toBe(FUTURE_END);
    expect(pending?.newStartsAt).toBe(newStart);
    expect(pending?.newEndsAt).toBe(newEnd);
    expect(pending?.original.id).toBe(`event-${EVENT_ID}`);
    expect(pending?.original.calendarId).toBe(EVENT_CAL_ID);
    expect(pending?.original.title).toBe("Quarterly review");
  });
});

describe("useEventReschedule.sendReschedule / persistSilently / revertReschedule", () => {
  /** Stage a pending attempt by running handleEventUpdate first, so the
   *  resolution methods have something to act on. */
  function stagePending(now: number = FIXED_NOW) {
    const updateEvent = vi.fn<UpdateEventMutation>(() => Promise.resolve());
    const calendarApp = makeCalendarApp();
    const newStart = FUTURE_START + 60 * 60 * 1000;
    const newEnd = FUTURE_END + 60 * 60 * 1000;
    const hook = renderHook(() =>
      useEventReschedule({
        events: [makeEvent({ nonOrganizerInviteeCount: 4 })],
        updateEvent,
        calendarApp,
        eventCalendarId: EVENT_CAL_ID,
        now: () => now,
      }),
    );
    act(() => {
      hook.result.current.handleEventUpdate({
        id: `event-${EVENT_ID}`,
        start: instant(newStart),
        end: instant(newEnd),
      });
    });
    expect(hook.result.current.pendingReschedule).not.toBeNull();
    return { hook, updateEvent, calendarApp, newStart, newEnd };
  }

  it("sendReschedule calls updateEvent with notifyInvitees=true and clears the staged attempt", () => {
    const { hook, updateEvent, newStart, newEnd } = stagePending();

    act(() => {
      hook.result.current.sendReschedule();
    });

    expect(updateEvent).toHaveBeenCalledTimes(1);
    expect(updateEvent).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      startsAt: newStart,
      endsAt: newEnd,
      notifyInvitees: true,
    });
    expect(hook.result.current.pendingReschedule).toBeNull();
  });

  it("persistSilently calls updateEvent with notifyInvitees=false and clears the staged attempt", () => {
    const { hook, updateEvent, newStart, newEnd } = stagePending();

    act(() => {
      hook.result.current.persistSilently();
    });

    expect(updateEvent).toHaveBeenCalledTimes(1);
    expect(updateEvent).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      startsAt: newStart,
      endsAt: newEnd,
      notifyInvitees: false,
    });
    expect(hook.result.current.pendingReschedule).toBeNull();
  });

  it("revertReschedule calls calendarApp.events.update with the original snapshot and skips the mutation", () => {
    const { hook, updateEvent, calendarApp } = stagePending();
    const expectedSnapshot = hook.result.current.pendingReschedule?.original;

    act(() => {
      hook.result.current.revertReschedule();
    });

    expect(updateEvent).not.toHaveBeenCalled();
    expect(calendarApp.updateSpy).toHaveBeenCalledTimes(1);
    expect(calendarApp.updateSpy).toHaveBeenCalledWith(expectedSnapshot);
    expect(hook.result.current.pendingReschedule).toBeNull();
  });

  it("revertReschedule swallows errors thrown by calendarApp.events.update", () => {
    // schedule-x can reject the manual update if the event was removed
    // in the meantime — the hook MUST NOT propagate; the diff effect
    // re-syncs on the next events query update.
    const updateEvent = vi.fn<UpdateEventMutation>(() => Promise.resolve());
    const updateSpy = vi.fn(() => {
      throw new Error("event removed");
    });
    const calendarApp: CalendarAppRescheduleHandle = {
      events: { update: updateSpy },
    };
    const { result } = renderHook(() =>
      useEventReschedule({
        events: [makeEvent({ nonOrganizerInviteeCount: 4 })],
        updateEvent,
        calendarApp,
        eventCalendarId: EVENT_CAL_ID,
        now: () => FIXED_NOW,
      }),
    );

    act(() => {
      result.current.handleEventUpdate({
        id: `event-${EVENT_ID}`,
        start: instant(FUTURE_START + 60 * 60 * 1000),
        end: instant(FUTURE_END + 60 * 60 * 1000),
      });
    });

    expect(() => {
      act(() => {
        result.current.revertReschedule();
      });
    }).not.toThrow();
    expect(result.current.pendingReschedule).toBeNull();
  });

  it("send/silent/revert are no-ops when no attempt is staged", () => {
    const updateEvent = vi.fn<UpdateEventMutation>(() => Promise.resolve());
    const calendarApp = makeCalendarApp();
    const { result } = renderHook(() =>
      useEventReschedule({
        events: [makeEvent({ nonOrganizerInviteeCount: 4 })],
        updateEvent,
        calendarApp,
        eventCalendarId: EVENT_CAL_ID,
        now: () => FIXED_NOW,
      }),
    );

    act(() => {
      result.current.sendReschedule();
      result.current.persistSilently();
      result.current.revertReschedule();
    });

    expect(updateEvent).not.toHaveBeenCalled();
    expect(calendarApp.updateSpy).not.toHaveBeenCalled();
  });
});
