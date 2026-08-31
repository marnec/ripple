# 03 — Create a repeating series and see its occurrences

**What to build:** The tracer bullet. An organizer opens the event form, sets
*Repeat* to *Weekly on Tuesday*, saves, and the standup appears on every Tuesday
in their calendar — and in a colleague's availability overlay — without any of
those Tuesdays existing as stored rows.

Introduces the series as a resource: its table, its rule, its local anchor and
duration, its timezone. Adds the two optional fields to calendar events that
overrides will later use, without anything writing them yet. Both calendar range
queries gain a second read of the workspace's live series, expand it through the
recurrence module, and merge the result with the existing scan of one-off
events.

The *Repeat* control is a single inline select offering *Does not repeat*
(default), *Daily*, *Weekly on <weekday>*, and *Monthly on the <nth> <weekday>*.
The *Custom…* option is a later ticket. Drag-to-create on the grid always makes
a one-off.

**Blocked by:** 02.

**Status:** done

- [x] Creating an event with *Does not repeat* behaves exactly as it does today,
      down to the row it writes.
- [x] Creating a weekly series shows an occurrence on every matching date in the
      personal calendar, across month boundaries and page changes.
- [x] The colleague-availability overlay shows a member's series occurrences as
      busy blocks, and still exposes only timing and member id — no title,
      description, venue, or organizer.
- [x] A series whose rule would exceed a cap is refused at save with a message
      naming the limit, not silently truncated.
- [x] A user who is not a member of the workspace cannot read a series or its
      occurrences.
- [x] The 24-hour duration cap still holds, and one-off events and their range
      query are provably unaffected.
- [x] Occurrences of a series anchored in another timezone appear at the correct
      local time for a viewer elsewhere.
- [x] The event detail page opens an occurrence.
- [x] No migration or backfill runs: existing events are untouched.
