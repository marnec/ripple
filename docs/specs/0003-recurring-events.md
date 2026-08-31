# Recurring calendar events

> Status: ready-for-agent. Single unit, no dependencies on specs 0001–0002.
> Decision record: ADR 0002. Vocabulary: **series**, **occurrence**,
> **original start**, **override**, **split**, **horizon** (CONTEXT.md).

## Problem Statement

Every meeting in Ripple has to be created one at a time. A team that holds a
standup every weekday morning creates it again every weekday morning, invites
the same five people again, picks the same channel venue again, and gets a
separate row in the calendar, a separate graph node, and a separate guest link
each time. A weekly retro run for a year is fifty-two acts of data entry
producing fifty-two unrelated events that nobody can rename, retag, move, or
cancel as one thing.

The costs land in three places. The organizer does the same work repeatedly and
has no way to say "move the standup to 09:30 from now on" — they must edit every
future instance by hand or accept that the calendar disagrees with reality.
Invitees receive an invitation email per instance, so a recurring meeting fills
their inbox and their mail client's calendar with entries their client has no
way to group. And anyone looking at a colleague's availability sees a wall of
individually-created blocks with no indication that they are one commitment.

The absence is visible in the product's own roadmap — "recurrent events in
calendar" has been the second item on the README's next-steps list — and it is
the single most common expectation a user brings to a calendar from any other
calendar they have ever used.

## Solution

An event gains a **repeat** setting. Choosing anything other than *Does not
repeat* creates a **series**: one resource holding the title, roster, venue,
tags, and a recurrence rule anchored to a wall-clock time in a timezone. The
calendar shows the series' **occurrences** on every date the rule produces,
computed rather than stored.

Because the series is the resource, it behaves as one thing: rename it once and
every future occurrence is renamed; invite someone once and they are invited to
all of it; cancel it once and it is gone. Guests receive a single invitation
email carrying the whole repeating pattern, which their mail client understands
natively and files as one recurring entry.

Because a real schedule is never quite regular, any single **occurrence** can be
moved, edited, or cancelled without disturbing the rest — becoming an
**override** or an excluded start. Edits offer three scopes: *this occurrence*,
*this and following* (which **splits** the series in two), and *all occurrences*.

Occurrences follow wall-clock time in the series' timezone, so a 09:00 standup
stays at 09:00 across daylight-saving transitions rather than drifting to 08:00
or 10:00 for half the year.

## User Stories

1. As an organizer, I want to mark a new event as repeating, so that I create
   the standup once instead of every weekday.
2. As an organizer, I want the repeat setting to default to *Does not repeat*,
   so that booking a one-off meeting is exactly as fast as it is today.
3. As an organizer, I want presets for daily, weekly on the event's weekday, and
   monthly on the event's nth weekday, so that the common patterns need no
   configuration at all.
4. As an organizer, I want a *Custom* option for an interval ("every two weeks")
   and an end, so that the less common patterns are still expressible.
5. As an organizer, I want to choose whether the series ends on a date, after a
   number of occurrences, or never, so that the rule matches what I actually
   committed to.
6. As an organizer, I want a series with no end date to be genuinely open-ended
   from my point of view, so that I never have to renew the standup.
7. As an organizer, I want my 09:00 meeting to stay at 09:00 after the clocks
   change, so that my team does not arrive an hour early twice a year.
8. As an organizer in one timezone with attendees in another, I want the series
   anchored to my timezone, so that the meeting keeps its meaning for the person
   who owns it.
9. As an organizer, I want to see how many occurrences a rule will produce
   before I save it, so that I do not discover a mistake after fifty invitations
   have gone out.
10. As an organizer, I want to move a single occurrence without touching the
    rest, so that I can shift one week's standup around a public holiday.
11. As an organizer, I want to rename or re-describe a single occurrence, so
    that one week's agenda can differ from the pattern.
12. As an organizer, I want to cancel a single occurrence, so that I can skip a
    week without ending the series.
13. As an organizer, I want to change the series from a given occurrence onward,
    so that "we move to 09:30 starting next month" is one action.
14. As an organizer, I want to change the whole series, so that a permanent
    correction does not require visiting every date.
15. As an organizer, I want to be told what an edit will apply to before it
    applies, so that I never accidentally change fifty meetings.
16. As an organizer, I want to be warned when an edit will discard occurrences I
    previously customised, so that the loss is a choice and not a surprise.
17. As an organizer, I want to delete a whole series in one action, so that a
    cancelled ritual leaves nothing behind.
18. As an organizer, I want dragging one occurrence on my calendar to move only
    that occurrence, so that a quick gesture never has consequences I did not
    intend.
19. As an organizer, I want resizing one occurrence to change only that
    occurrence's length, for the same reason.
20. As an organizer, I want the "notify invitees?" prompt to tell me how many
    people and how many occurrences are affected, so that I can judge whether
    the change is worth an email.
21. As an organizer tidying up past meetings, I want no notifications sent when
    every affected occurrence is already in the past, so that housekeeping does
    not spam my team.
22. As an organizer, I want tagging a series to tag the series and not each
    occurrence, so that the workspace's tag lists stay meaningful.
23. As an organizer, I want to invite someone to the series after it has
    started, so that a new team member joins the standup rather than one
    instance of it.
24. As an organizer, I want to remove someone from the series, so that they stop
    receiving all of it in one action.
25. As an organizer, I want the series to reuse one meeting room across every
    occurrence, so that the join link I share once keeps working.
26. As an organizer, I want each occurrence's call to produce its own transcript
    document, so that last week's notes are not overwritten by this week's.
27. As an invitee, I want a single invitation email describing the whole
    pattern, so that my inbox holds one message rather than fifty.
28. As an invitee, I want my mail client to show the meeting as one recurring
    entry, so that my personal calendar matches the team's.
29. As an invitee, I want an occurrence that was moved to show at its new time in
    my mail client, so that I do not attend an empty room.
30. As an invitee, I want to RSVP once for the series, so that accepting is one
    action rather than one per week.
31. As an invitee, I want a cancelled series to be withdrawn from my calendar, so
    that I do not keep a dead meeting.
32. As an external guest, I want my share link to keep working for the whole
    life of the series, so that I am not locked out halfway through.
33. As an external guest of an open-ended series, I want my link to keep working
    as long as I keep using it, so that an indefinite commitment does not need a
    new link every year.
34. As a workspace member, I want a colleague's recurring commitments to show in
    the availability overlay, so that I can find a time that is actually free.
35. As a workspace member, I want the overlay to keep showing only *when* a
    colleague is busy and never *what* they are doing, exactly as it does today.
36. As a workspace member, I want `@`-mentioning the standup to link to the
    standup, so that a chat reference means the ritual and not one Tuesday.
37. As a workspace member, I want mention autocomplete to offer the series once,
    so that the picker is not flooded with a hundred identically-named entries.
38. As a workspace member, I want the workspace graph to hold one node per
    series, so that the graph stays a picture of the workspace rather than of
    the calendar's arithmetic.
39. As a recipient of a notification about one occurrence, I want the link to
    open that occurrence, so that "moved to Thursday" lands on the right date.
40. As a recipient of a notification about the series, I want the link to open
    the next upcoming occurrence, so that an old link is never a dead page.
41. As a viewer of an occurrence, I want to see that it repeats and how many are
    left, so that I understand what I am looking at.
42. As a viewer of an occurrence, I want a way to reach the series, so that I can
    change the pattern from where I noticed the problem.
43. As a user dragging on the calendar grid to create an event, I want a plain
    one-off, so that the fastest way to create something stays the simplest.
44. As a user, I want a rule that would produce an absurd number of occurrences
    to be refused with an explanation, so that I fix the rule rather than
    silently getting a partial calendar.
45. As a workspace admin, I want deleting a workspace to remove its series along
    with everything else, so that no orphaned rows survive.

## Implementation Decisions

### Data model

- A new **series** table holds: workspace, title, description, timezone, channel
  venue, creator, tags, the recurrence rule, the local anchor, the duration, the
  excluded starts, the meeting id, and the sequence counter. It is the resource;
  it owns everything a one-off event owns today.
- The **anchor** is a local date plus a wall-clock time plus an IANA timezone,
  with a separate duration in milliseconds — not a UTC start and end. This is
  what makes wall-clock semantics representable at all; storing a UTC instant
  and adding a fixed stride is the bug this avoids.
- The **rule** is a structured object validated by Convex validators, never an
  RRULE string. Fields: frequency (daily / weekly / monthly / yearly), interval,
  weekdays (weekly), monthly mode (by month-day or by nth weekday), and an end
  that is a date, a count, or none. RRULE text is a wire format produced for ICS
  by a serializer, and is never parsed back.
- **Excluded starts** is an array of original-start timestamps on the series.
  A cancelled occurrence produces no row of any kind.
- **Overrides** are `calendarEvents` rows that gain two new optional fields: the
  series they belong to, and the original start they are filed under. They are
  full rows, not patches.
- One-off events are unchanged. No migration and no backfill: the two new
  `calendarEvents` fields are optional, and existing rows stay exactly as they
  are.
- Indexes: series by workspace and end-bound, so ended series fall out of the
  range; overrides by series and original start, for the point lookup during
  expansion.

### The recurrence module

- A new pure module in the shared package is the single home for: expanding a
  rule + anchor + excluded starts over a window into occurrences; serializing a
  rule to `RRULE` and excluded starts to `EXDATE`; computing the truncation for
  a **split**; enforcing the caps; and the "every affected occurrence is in the
  past" predicate.
- It imports Temporal and nothing else — no Convex, no React, no DOM. Both the
  backend queries and the web forms consume it, which removes the current
  duplicated client/server copies of the historical-reschedule predicate rather
  than adding a third.
- Ambiguous and nonexistent local times resolve with Temporal's `compatible`
  disambiguation: push forward into a spring-forward gap, take the earlier of a
  repeated autumn hour. This matches Google and Outlook.
- The shared package gains a vitest config and a test script, following the
  pattern the partykit and rsvp-worker packages already use.

### Limits

- **Horizon**: 24 months past the requested window end. No expansion ever runs
  further, whatever the rule says.
- **366 occurrences** materialised per window query. Exceeding it is refused,
  not truncated — a short calendar is indistinguishable from a quiet one, the
  same reasoning the member-overlay cap already uses.
- **200 excluded starts** per series.
- **10 years** maximum series span at creation, so "never" is honest about being
  long rather than infinite.
- The existing 24-hour cap on a single event's duration is unchanged and still
  load-bearing.

### Queries

- The two calendar range queries keep their current index scan for one-off
  events and overrides — its completeness still rests on the 24-hour duration
  cap — and gain a second, separate read of the workspace's live series, which
  they expand in the handler and merge.
- Merge rule: for each occurrence the rule produces, an override at that original
  start replaces it; an excluded start removes it.
- The read set of the series read is every live series in the workspace, so any
  series write re-runs every open calendar query there. Accepted deliberately in
  ADR 0002; the mitigation is the end-bound index range, not a wider cap.
- The availability overlay expands series identically and continues to emit only
  timing and member id — no title, description, venue, or organizer.
- The invitee-count carried on each returned occurrence is computed once per
  series and stamped on every occurrence it produces.

### Editing

- Three scopes: *this occurrence*, *this and following*, *all occurrences*. The
  scope is chosen in a dialog **on save**, never as a mode entered before
  editing.
- *This occurrence* writes or updates an override; a cancel writes an excluded
  start instead.
- *This and following* is a **split**: the original series is truncated to end
  before the chosen original start, and a second series is created carrying the
  change, the roster, and the remaining rule. The second series is a genuinely
  separate resource with its own id, node, share links, and mention target.
- *All occurrences* divides in two. A **rule edit** (recurrence, anchor, or
  duration) resets every override, with a confirmation stating how many will be
  reset. A **content edit** (title, description, tags, venue, roster) leaves
  overrides standing and does not propagate into them.
- Drag and resize on the dashboard calendar always produce a single-occurrence
  override and never edit the series. No scope dialog fires on a drag.

### Authoring UI

- A single *Repeat* select inline in the event form: *Does not repeat* (default)
  / *Daily* / *Weekly on <weekday>* / *Monthly on the <nth> <weekday>* /
  *Custom…*, where only *Custom…* opens a dialog for interval and end.
- The grid's drag-to-create always produces a one-off with no rule.
- The event detail page renders the occurrence, states that it repeats and how
  many remain in one line, and links to the series.

### Links and identity

- An occurrence's URL carries the series id plus an original-start coordinate.
- A notification about one occurrence links with the coordinate; a notification
  about the series links bare, and a bare link resolves to the next occurrence
  from now, falling back to the last one when the series has ended.
- `@`-mentions target the series and render bare.

### Graph, tags, and search

- The series is the resource: one graph node, one set of tag rows, one mention
  autocomplete entry.
- Overrides must be **excluded** from both the `calendarEvents` node trigger and
  the mention-autocomplete search index. Both currently act on every row in that
  table, so the exclusion is an explicit condition that must be written and
  tested — it is not the default.
- The venue edge from a series to its hosting channel mirrors the existing event
  behaviour.

### Email and ICS

- A guest receives one `VEVENT` carrying `RRULE` and `EXDATE`, under a UID
  derived from the series, plus one `RECURRENCE-ID` `VEVENT` per override so a
  moved occurrence shows at its new time.
- One `SEQUENCE` counter, on the series, bumped on any change that mails guests.
  The `sequence` field on an override row is unused and left unwritten.
- A **split** sends the truncated original as an update and the new series as a
  fresh invitation under a new UID. No `CANCEL` is sent, because cancelling makes
  clients delete history the user did not ask to lose.
- Inbound RSVP replies continue to have any `RECURRENCE-ID` **dropped** and the
  response applied to the series. The asymmetry with the outbound path is
  deliberate and should be commented at both sites.
- Notification fan-out reuses the existing prompt, extended with the edit scope
  so the copy names what will be sent.

### RSVP

- Invitee rows point at the series, and RSVP is series-level for members and
  guests alike.
- The invitee row gains an optional original-start field from day one,
  `undefined` meaning "the series", so per-occurrence decline later becomes a UI
  and index change rather than a migration of every roster.

### Calls

- One meeting room per series, created lazily on first join of any occurrence —
  the same shape as a channel's persistent room.
- The call-session table gains a polymorphic venue (channel or series/event) and
  records which occurrence a call happened in, stamped at session creation by
  resolving the join window. It is **not** keyed on the occurrence: a call that
  starts early or runs long must not have to decide what it is before it can
  exist.
- This incidentally gives standalone event calls the transcript path they have
  never had, which is a scope increase this spec accepts explicitly.

### Deletion

- Deleting a series cascades to its overrides, invitee rows, guest shares, node,
  edges, and tag rows. Past occurrences go with it; nothing of record is lost,
  because transcripts are documents and the trail is in the audit log, and both
  already outlive an event.
- Workspace deletion cascades to series alongside events.

### Writes

- Every mutation uses the project's trigger-wrapped mutation builders. No
  handler re-wraps the database, per the standing deadlock rule.

## Testing Decisions

A good test here asserts observable behaviour at a module's interface: given a
rule and a window, which occurrences come out; given a mutation and an actor,
what the queries then return and who is refused. It does not assert which
internal helper ran, how many reads a handler performed, or the shape of an
intermediate value. The repository's existing pure-core tests are the model —
they exercise interfaces with plain vitest and no jsdom.

**The recurrence module (new seam, plain vitest).** The highest-value surface in
the feature, and where the genuinely hard cases live:

- Weekly, daily, monthly-by-date, monthly-by-nth-weekday and yearly expansion
  over a window, including windows that start mid-series and windows that
  contain no occurrence.
- Interval greater than one, and weekly rules with several weekdays.
- Each of the three end kinds — date, count, none — and the interaction of
  "none" with the horizon.
- Daylight saving in both directions, in a southern-hemisphere zone as well as a
  northern one: the wall-clock time must not move.
- A spring-forward gap that swallows the anchor time, and an autumn hour that
  occurs twice.
- Excluded starts removing occurrences; overrides replacing them; an override
  moved outside the queried window; an override whose original start no longer
  exists after a rule change.
- Every cap: horizon, per-window occurrence count, excluded-start count, series
  span — each refused rather than truncated.
- RRULE and EXDATE serialization for each rule shape.
- Split truncation, including a split at the first occurrence and at the last.
- The "every affected occurrence is in the past" predicate across scopes.

**The Convex function surface (existing seam, `convex-test`).** Prior art is the
existing family of calendar event tests — in particular the range-query test,
the membership-access test, the invite-edge test, the reschedule-shares test,
and the cascade-delete test, all of which extend naturally:

- Creating a series, then asserting the range queries return its occurrences in
  a window, and that a non-member is refused.
- Each edit scope's effect on subsequent query results: one override, a split
  producing two series, and a whole-series edit.
- A rule edit resetting overrides; a content edit leaving them standing.
- Cancelling one occurrence removing it from the range queries while the series
  survives.
- The availability overlay including series occurrences and still leaking no
  titles.
- **An override producing no graph node and appearing in no mention
  autocomplete result** — the exclusions that would otherwise happen by default,
  and the tests that stop someone deleting the condition later.
- RSVP applying at the series level and reaching every occurrence.
- Deleting a series cascading to overrides, invitees, shares, node, and edges;
  and workspace deletion cascading to series.
- Guest share expiry for a bounded series, and lazy extension for an unbounded
  one.
- Notification fan-out firing for a future-affecting edit and staying silent
  when every affected occurrence is past.

**The rsvp-worker parser (existing seam).** One added case: a reply carrying a
`RECURRENCE-ID` has it dropped and applies to the series.

**The web pure utils (existing seam).** The rule presets derived from a chosen
date, and the occurrence-count preview text.

No new test seam is introduced beyond the recurrence module. ICS assembly stays
module-private and untested, as it is today; the only part worth asserting is
the rule text, which the recurrence module owns.

## Out of Scope

- **Per-occurrence RSVP.** "I can't make this Tuesday" is the most likely
  follow-up and the invitee row is shaped to accept it later, but neither the UI
  nor the inbound handling is built here.
- **Inbound `RECURRENCE-ID` handling.** Guest replies about one occurrence apply
  to the series; honouring them requires per-occurrence RSVP above.
- **Recurring tasks.** A recurring task has independent completion state per
  occurrence, which makes occurrences genuine resources — the opposite of this
  spec's central decision. It is a different feature.
- **Full RFC 5545 expressiveness.** No `BYSETPOS` beyond nth-weekday, no
  multiple rules per series, no `RDATE`, no per-occurrence duration in the rule.
- **Importing external recurring calendars.** Nothing here reads an external
  ICS feed or syncs with Google or Outlook.
- **Reminders.** No occurrence-level "starting in 10 minutes" scheduling exists
  today and none is added; the notification story stays change-driven.
- **Attaching a rule to an existing one-off event.** Repeat is chosen at
  creation or by editing a series that already has one.
- **Per-occurrence tags, per-occurrence sharing, and per-occurrence graph
  presence.** All follow from the series being the resource.

## Further Notes

The two decisions most likely to be questioned later, and the reasons to leave
them alone, are both recorded in ADR 0002. First, occurrences are computed
rather than materialised, which means the calendar queries read every live
series in the workspace and re-run on any series write — the alternative puts
rows in the database nobody wrote and multiplies every per-row mechanism by the
occurrence count. Second, the series read is a *second* read rather than a
change to the existing scan, precisely because that scan's correctness rests on
the 24-hour duration cap; adding a rule-bearing row to that table would break it
silently and only for windows after the first.

The exclusion of overrides from the node trigger and the mention search index is
the sharpest trap in the feature. Both mechanisms act on every row in the events
table today, so doing nothing produces a graph and an autocomplete list quietly
polluted with duplicates of every rescheduled Tuesday. That is why it appears in
this spec as a named implementation decision, in the ADR's consequences, and in
the test list.

The call-session change is the one place the feature's blast radius exceeds
recurrence itself. Giving sessions a polymorphic venue is what lets each
occurrence's call own its transcript, and it closes a pre-existing gap where
standalone event calls produced no transcript at all. That is a real improvement
arriving as a side effect, and it should be reviewed as one rather than slipped
in unremarked.
