# Scheduled cycle start

> Status: ready-for-agent. Depends on the cycle history logging
> (`became_current`, `carried_in`, `taskIds` on cycle audit entries).

## Problem Statement

Cycles are opened and closed by hand. A team that works in fixed two-week
cycles has to remember to close the old cycle and pick where its unfinished
work goes, on the right day, every time. When nobody does it, the "current"
cycle silently runs past its end date, and any report on that cycle measures
the wrong window.

`startDate` and `dueDate` exist but are informational. Nothing happens when they
arrive.

## Solution

A **future start date on a cycle that is not current is a commitment**: at that
date, the cycle becomes current, and the cycle that was current closes. Where
that cycle's unfinished tasks go is part of the commitment, chosen when the
date is set: into the starting cycle, or back to the backlog.

Cycles without a future start date behave exactly as today. Nothing is
scheduled unless someone sets a date, so manual cycles stay the default and
the automatic behaviour is opt-in for each cycle.

Only `startDate` gets this meaning. `dueDate` stays informational: a cycle ends
when the next one starts, or when someone closes it.

## Rules

1. **When it applies.** A cycle has a scheduled start when it is open, it is not
   the project's current cycle, and its `startDate` is later than today at the
   moment the date is saved. A date in the past or today does nothing and stays
   informational. Otherwise backdating a cycle would close the current one on
   the spot.
2. **What happens at the start.** At 00:00 on `startDate`, in the cycle's
   timezone (rule 5):
   - If the project has a current cycle, it closes, and its unfinished tasks
     go where the starting cycle's `unfinishedTo` says (rule 7). This is the
     existing `close`, with `{ kind: "cycle" }` pointing at the starting cycle
     or `{ kind: "backlog" }`.
   - The starting cycle becomes current. If there was no current cycle, this is
     the only step.
   - Both steps run in one transaction, with the actor `system:cycles`.
3. **Fulfilled early.** If someone makes the cycle current by hand before its
   date (`setCurrent`, or a close that hands over to it), the commitment is met
   and the scheduled start is cancelled.
4. **Cancelled.** Clearing or moving the date, closing the cycle, or deleting it
   cancels the scheduled start. Moving the date to another future date
   reschedules it.
5. **Timezone.** `startDate` is a date with no time attached. When a future date
   is saved, the cycle stores the saver's IANA timezone, the way
   `eventSeries.timezone` does. Workspaces have no timezone of their own today.
6. **No ties.** Two cycles in the same project cannot have a scheduled start on
   the same date. The second save is refused, with a message naming the
   other cycle.
7. **Unfinished work is decided up front.** Saving a future start date requires
   a destination for the current cycle's unfinished tasks: `carry` (into this
   cycle, preselected) or `backlog`. It is stored on the starting cycle, because
   that cycle's commitment is the thing that will close the other one. The
   choice can be changed until the start fires. There is no "ask me at the
   time" option, because nobody is there to ask at 00:00.

## Mechanism

- **Schema.** Add to `cycles`:
  `startTimezone: v.optional(v.string())`,
  `startJobId: v.optional(v.id("_scheduled_functions"))`, and
  `unfinishedTo: v.optional(v.union(v.literal("carry"), v.literal("backlog")))`.
  All three are set together when a start is scheduled and cleared together
  when it is cancelled or fires.
- **Scheduling.** `cycles.update` (and `create`, when a date is passed) runs
  `ctx.scheduler.runAt(localMidnight, internal.cycles.startScheduled, { cycleId, startDate })`
  and stores the job id. It cancels any previous job first.
- **One job per cycle, no cron.** A daily sweep would read every project to find
  the few cycles that are due.
- **Stale jobs are harmless.** `startScheduled` re-checks rule 1 when it runs:
  the cycle is still open, not already current, and its `startDate` still equals
  the scheduled date. Otherwise it does nothing. Cancelling a job (rules 3–4) is
  then about tidiness, not correctness.
- **Shared code.** The close-and-hand-over steps are taken out of `cycles.close`
  into a helper that both paths call, so the carry-over and its audit entries
  (`closed` with `taskIds`, `carried_in`) are identical whether a person or the
  schedule triggered them.
- **Limit.** `CLOSE_MAX_UNFINISHED` still applies. If the current cycle has more
  unfinished tasks than that, the scheduled start becomes current *without*
  closing the old cycle, and logs that it could not close it, rather than
  failing and starting nothing.

## UI

The commitment must be visible wherever it can surprise someone:

- **The start-date field looks as it does today** until a future date is picked
  on a non-current cycle. A team that never schedules cycles never sees any of
  this. Explaining the feature up front would put information in front of
  people who don't need it.
- **Once a future date is picked**, two lines appear under the field before
  saving:
  - "Cycle 3 closes on Mon 13 Oct."
  - "Its unfinished tasks: **Move here** / Back to backlog." This is a
    two-option segmented control, with *Move here* preselected.

  Clearing the date or picking a past one removes both lines again.
- **On the scheduled cycle:** "Starts Mon 13 Oct · Cycle 3 closes then, and its
  unfinished tasks move here" (or "…go back to the backlog").
- **On the current cycle:** "Ends Mon 13 Oct, when Cycle 4 starts."
- **In the workspace timeline:** the existing `closed` / `carried_in` /
  `became_current` entries, attributed to "System".

## Out of scope

- Repeating cycles ("a new two-week cycle every other Monday"). Creating the
  next cycle with a date stays manual. Revisit once scheduled starts are in use.
- Any behaviour attached to `dueDate`.
- Notifications about an upcoming start.

## Tests

- A scheduled start fires with `carry`: the old cycle closes, unfinished tasks
  move into the new one, completed tasks stay, the new cycle is current, and
  the entries are attributed to `system:cycles`.
- The same with `backlog`: unfinished tasks land in the backlog, and there is
  no `carried_in` entry.
- Saving a future start date without `unfinishedTo` is refused. Changing it
  before the start takes effect at the start.
- A past or same-day date schedules nothing.
- Setting the cycle current by hand, then running the job, does nothing.
- Moving the date reschedules, and the old job does nothing if it runs.
- Closing or deleting the cycle cancels the start.
- A second cycle with the same scheduled date is refused.
- No current cycle: the start makes the cycle current and closes nothing.
- Over `CLOSE_MAX_UNFINISHED`: the cycle still starts, and the old one stays
  open.
