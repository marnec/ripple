# Plan: Extract MyCalendarTab state machines into testable hooks

> Source PRD: [marnec/ripple#1](https://github.com/marnec/ripple/issues/1) — Refactor: extract MyCalendarTab state machines into testable hooks

## Architectural decisions

Durable decisions that apply across all phases:

- **Scope**: pure frontend refactor. No Convex schema, validators, mutations, queries, or HTTP endpoints change. Backend tests untouched.
- **Hook location**: all new hooks live under `apps/web/src/pages/App/Dashboard/hooks/`.
- **Hooks to extract** (one per phase, each independently demoable):
  - `useEventDragCreate` — drag-to-create state machine. Inputs: calendar grid lookup primitives + `onCreate(initialDate)`. Returns `{ beginCreator, creator, dismissCreator }`. Owns the synchronous-document-listener trick, the 4 px click-vs-drag threshold, and the snap-to-15-min math.
  - `useEventReschedule` — reschedule decision flow + modal staging. Inputs: events query result, the `update` Convex mutation, calendar-app handle (for optimistic revert). Returns `{ handleEventUpdate, pendingReschedule, sendReschedule, persistSilently, revertReschedule }`. Internally uses `isHistoricalReschedule`. `RescheduleAttempt` moves into this file.
  - `useScheduleXEventBinding` — React-state → schedule-x internal-store sync. Inputs: `(calendarApp, { events, backgroundEvents })`. Returns nothing. Holds both diff key refs and is the **only** site of the `as unknown as { $app: { calendarEvents: { backgroundEvents: { value } } } }` cast (documented as the v4 quarantine zone).
- **Stays in `MyCalendarTab.tsx`** (per PRD design decision):
  - Calendar app + plugin instances (the `useState` lazy initializer).
  - The `onEventUpdateRef` trampoline (the drag-and-drop plugin captures its callback at construction time; replacing the ref breaks the fresh-state read pattern).
  - `ScheduleXCalendar` wrapper + `customComponents` identity.
- **Shared constants**: all three hooks read snap granularity, slot minutes, and pixel thresholds from `apps/web/src/pages/App/Calendar/calendar-grid-constants.ts`. No hook redefines these.
- **React Compiler**: no `useCallback` / `useMemo` for memoisation in any new hook. Returned functions are plain.
- **Type safety floor**: no new `as any`, `// @ts-expect-error`, or `eslint-disable` directives. The single `as unknown as { $app: ... }` cast is allowed and lives only inside `useScheduleXEventBinding`.
- **Test pattern**: new `renderHook` tests (from `@testing-library/react`) for hooks with deterministic outputs; assert observable output (snap result, click-vs-drag classification, staged `pendingReschedule` shape, mutation arg shape), never internal state shape or ref identity. `useScheduleXEventBinding` is intentionally not unit-tested — DOM / schedule-x coupled.
- **Behaviour preservation is load-bearing**. The manual smoke checklist in the PRD is the merge gate; new hook tests are a regression net, not a substitute.

---

## Phase 1: Extract `useEventDragCreate`

**User stories**: 1, 5, 7, 9 (drag-to-create surface), 13 (in part: synchronous-listener + popover-dismiss race), 14

### What to build

Lift the drag-to-create state machine out of `MyCalendarTab` into a focused hook. The hook owns the `mousedown` handler that synchronously attaches document-level `mousemove` / `mouseup` listeners (to beat React batching), the 4 px click-vs-drag threshold, the snap-to-15-min math, and the popover-creator state. `MyCalendarTab` shrinks to wiring grid lookup primitives + an `onCreate(initialDate)` callback into the hook and rendering whatever popover/creator UI the hook surfaces. The base-ui popover-from-mouseup race fix (capture-phase `stopImmediatePropagation`) is preserved verbatim inside the hook.

### Acceptance criteria

- [ ] `useEventDragCreate` exists under `apps/web/src/pages/App/Dashboard/hooks/` with `{ beginCreator, creator, dismissCreator }` return shape.
- [ ] `MyCalendarTab.tsx` no longer contains the inline drag-to-create state machine; it calls `useEventDragCreate` and forwards `beginCreator` to the time-grid mousedown surface.
- [ ] `renderHook` tests pin: (a) mousedown + mouseup with no movement does **not** fire `onCreate`; (b) mousemove past 4 px + mouseup fires `onCreate` with the snapped 15-min start; (c) cursor Y → epoch ms snap matches expected slot boundaries at multiple Y positions; (d) popover dismiss resets state so subsequent mousedowns work.
- [ ] No `useCallback` / `useMemo` / `as any` / `eslint-disable` introduced.
- [ ] Manual smoke items 1 (drag → ghost popover at snapped slot) and 8 (popover dismiss does not re-open creator) pass.
- [ ] `npm run lint` and `npm test` green.

---

## Phase 2: Extract `useEventReschedule`

**User stories**: 2, 6, 7, 10, 13 (in part: ref-trampoline preservation), 14

### What to build

Lift the reschedule decision flow into a hook that owns the modal staging state, the historical-edit short-circuit, the no-guests silent-persist path, the with-guests staged-prompt path, and the optimistic revert. `MyCalendarTab` keeps its `onEventUpdateRef` trampoline inline (the drag-and-drop plugin's callback registry captures the ref at construction) and plugs the hook's `handleEventUpdate` into it. The existing `NotifyInviteesDialog` props don't change; the parent reads `pendingReschedule` from the hook and dispatches `sendReschedule` / `persistSilently` / `revertReschedule` based on user choice. The `RescheduleAttempt` type moves into the hook file.

### Acceptance criteria

- [ ] `useEventReschedule` exists under `apps/web/src/pages/App/Dashboard/hooks/` with `{ handleEventUpdate, pendingReschedule, sendReschedule, persistSilently, revertReschedule }` return shape; `RescheduleAttempt` co-located.
- [ ] `MyCalendarTab.tsx` no longer contains `pendingReschedule` `useState`, the reschedule effect, or `handleRescheduleChoice`; the `onEventUpdateRef` trampoline stays inline and forwards into the hook.
- [ ] `renderHook` tests pin: (a) no-op when start and end are unchanged; (b) silent persist when invitee count is zero; (c) silent persist when the edit is historical (past → past); (d) `pendingReschedule` is staged with the correct shape when there are guests and the edit is in the future; (e) `revertReschedule` calls the calendar-app stub's optimistic-rollback path; (f) `sendReschedule` invokes the Convex mutation stub with `notifyInvitees: true`; (g) `persistSilently` invokes it with `notifyInvitees: false`.
- [ ] No `useCallback` / `useMemo` / `as any` / `eslint-disable` introduced.
- [ ] Manual smoke items 2 (reschedule with attendees → prompt), 3 (no attendees → silent), and 4 (past → past silent) pass.
- [ ] `npm run lint` and `npm test` green.

---

## Phase 3: Extract `useScheduleXEventBinding`

**User stories**: 3, 4, 8, 11, 12, 13 (in part: schedule-x sync semantics)

### What to build

Lift both diff effects (the `events` diff key + the `backgroundEvents` diff key) and the single private-state cast into a fire-and-forget hook keyed off the calendar app and the two arrays. The hook is the **only** place in the codebase that touches `calendarApp.events.add/update/remove/getAll` and `(calendarApp as unknown as { $app: { calendarEvents: { backgroundEvents: { value } } } }).$app.calendarEvents.backgroundEvents.value`. A doc comment at the top of the file marks this as the schedule-x v4 quarantine zone for future upgrades. `MyCalendarTab` drops both effects and the diff key refs.

No unit tests — the hook is DOM- and schedule-x-coupled (per PRD). Coverage falls on existing rendered-page tests + the manual smoke checklist.

### Acceptance criteria

- [ ] `useScheduleXEventBinding` exists under `apps/web/src/pages/App/Dashboard/hooks/`, returns nothing, and contains the only `as unknown as { $app: ... }` cast in the codebase under `apps/web/src/pages/App/Dashboard/`.
- [ ] File header doc comment names the hook as the v4 quarantine zone and references the upgrade-risk audit point (PRD user story 8).
- [ ] `MyCalendarTab.tsx` no longer contains `eventsKeyRef`, `bgEventsKeyRef`, or any direct call to `calendarApp.events.*` / `backgroundEvents.value =`.
- [ ] No `useCallback` / `useMemo` / `as any` / `eslint-disable` introduced (the documented `as unknown as` cast inside the hook is the only exception, and it predates this phase).
- [ ] Manual smoke items 5 (click event → opens detail sheet/page), 6 (member-calendar filter toggle adds/removes background events live), and 7 (empty-state overlay appears with no events + no tasks in range) pass.
- [ ] `npm run lint` and `npm test` green.

---

## Phase 4: Smoke gate + line-count acceptance

**User stories**: PRD acceptance gate (a–d) — covers all stories in aggregate.

### What to build

A non-functional gate phase that verifies the integrated refactor against the PRD's merge criteria. No new code; this is the QA + diff hygiene pass. Walk the full 8-item manual smoke checklist against a fresh `npm run dev`, confirm the file shrank below the line ceiling, and confirm the diff introduces no forbidden constructs.

### Acceptance criteria

- [ ] `apps/web/src/pages/App/Dashboard/MyCalendarTab.tsx` is under 800 lines.
- [ ] Diff introduces zero new `useCallback`, `useMemo` (for memoisation), `as any`, `// @ts-expect-error`, or `eslint-disable` directives. The single documented `as unknown as { $app: ... }` cast lives only inside `useScheduleXEventBinding`.
- [ ] All 8 manual smoke checklist items from the PRD pass on a fresh dev build:
  1. Drag on empty grid → ghost popover at snapped 15-min slot.
  2. Drag-resize an event with attendees → reschedule prompt with correct before/after labels.
  3. Drag-resize an event with no attendees → silent persist, no dialog.
  4. Drag-resize a past event to another past time → silent persist.
  5. Click an event (no drag) → opens detail sheet (desktop) / page (mobile).
  6. Member-calendar filter toggle → background events appear/disappear.
  7. Empty-state overlay shows when no events and no tasks in range.
  8. Popover dismiss after creator open does not re-open the creator.
- [ ] `npm run lint` (0 warnings) green.
- [ ] `npm test` green — new hook tests + existing 510-test regression net all pass.
- [ ] `npm run build` succeeds.
