# Recurring events: the series is the resource, occurrences are computed

A recurring meeting is stored as one `eventSeries` row — a rule plus a local
anchor (date, wall-clock time, IANA timezone) and a duration — and its
occurrences are expanded at read time rather than stored. Only an occurrence
that has been *edited* becomes a row, as a `calendarEvents` row carrying
`seriesId` + `originalStartMs`; only a *cancelled* occurrence becomes an entry
in the series' `excludedStarts` array. An occurrence's identity is the pair
(series, original start), not a row id, because in the general case there is no
row.

## Considered options

**Materialize occurrence rows into `calendarEvents` ahead of a horizon.**
Rejected. It is the option that touches no existing query — `eventsTouchingWindow`
would keep working untouched — but it puts rows in the database that nobody
wrote, needs a cron to stay ahead of the horizon, turns every series edit into a
bulk rewrite, and multiplies the per-row machinery an event already drags along
(a `nodes` row, `entityTags` rows, a `by_title` search entry, guest
`resourceShares`) by the occurrence count. A weekly standup running two years
would be 104 graph nodes.

**An optional rule on `calendarEvents` itself, with a `seriesId` self-reference.**
Rejected because it breaks the invariant the current calendar queries'
*correctness* rests on: `eventsTouchingWindow` is a complete candidate set only
because `validateTimes` caps every row at 24 hours, so anything touching the
window must start within 24 hours before it. A rule-bearing row has one
`startsAt` and would be silently missing from every window that isn't its first.

## Consequences

- The existing 24h-capped `by_workspace_starts` scan keeps working unchanged,
  and keeps carrying one-off events *and* overrides. Series expansion is a
  second, separate read against `eventSeries`.
- That second read's read set is "every live series in this workspace", so any
  series write re-runs every open calendar query in the workspace. This is the
  failure mode the `edges` table hit with channel mentions (see **mention
  counter** in CONTEXT.md) and it is only acceptable here because series count
  grows with meetings-that-repeat, not with user activity. If that stops being
  true, the fix is a narrower index range, not a wider cap.
- An unbounded series is a property of the rule, never of a read: expansion is
  capped at a horizon past the requested window, and a rule that would yield
  more than the per-window cap is refused rather than truncated.
- "This and following" is a **split** — truncate the original with an `until`
  and create a second series — so it produces a genuinely second resource with
  its own id, node, share links and mention target.
- Occurrences are wall-clock in the series' timezone, not a fixed millisecond
  stride, so they survive DST. This makes `calendarEvents.timezone` load-bearing
  where it was previously close to decorative.
- An override is not a resource, and that costs an explicit `if` in two places
  that would otherwise do the wrong thing by default: the `calendarEvents` node
  trigger (which fires on every insert into that table) and the `by_title`
  mention-autocomplete search index (which would offer every rescheduled
  Tuesday under the series' own name). Both belong in tests.
- A drag or resize on the dashboard calendar always produces an override and
  never edits the series — the cheap gesture stays cheap, and changing the rule
  is always a deliberate act.
- A series-wide **rule** edit (recurrence, anchor, duration) resets every
  override, because the original starts they are filed under may no longer
  exist. A series-wide **content** edit (title, description, tags, venue,
  roster) leaves overrides untouched and does not propagate into them.
- Guests get one `VEVENT` with `RRULE` + `EXDATE`, plus one `RECURRENCE-ID`
  `VEVENT` per override, under a single series-level `SEQUENCE`. Inbound RSVP
  replies still have their `RECURRENCE-ID` dropped and applied to the series —
  a deliberate asymmetry, since outbound correctness is free and inbound
  correctness needs the per-occurrence invitee coordinate that v1 defers.
- `callSessions` gains a polymorphic venue and records which occurrence a call
  happened in (stamped at session creation from the join window), rather than
  being keyed on the occurrence. A call that starts early or runs long must not
  have to decide what it is before it can exist. This incidentally gives
  standalone event calls the transcript path they never had.
