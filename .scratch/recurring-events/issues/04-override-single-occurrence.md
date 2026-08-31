# 04 — Override a single occurrence

**What to build:** One Tuesday can differ from the pattern. An organizer moves,
renames, re-describes, or cancels a single occurrence and the rest of the series
is undisturbed. Dragging or resizing a box on the dashboard calendar always does
this — it never edits the series — so the cheapest gesture stays the safest one.

A moved or edited occurrence becomes an override: a calendar-event row filed
under its original start, which stops tracking the series entirely. A cancelled
occurrence becomes an entry in the series' excluded starts and costs no row at
all.

This ticket carries the feature's sharpest trap. Overrides live in the same table
as ordinary events, whose node trigger and mention-autocomplete search index act
on every row — so without an explicit exclusion, every rescheduled Tuesday
quietly becomes a second graph node and a duplicate autocomplete entry under the
series' own name. Both exclusions must be written and both must be tested.

**Blocked by:** 03.

**Status:** done

- [x] Moving one occurrence shows it at its new time and leaves every other
      occurrence where it was.
- [x] Renaming one occurrence changes only that occurrence's title.
- [x] Cancelling one occurrence removes it from the calendar while the series and
      all other occurrences survive.
- [x] Dragging a box moves only that occurrence; resizing changes only its
      length; neither opens a scope dialog.
- [x] An override moved outside the currently visible window still resolves
      correctly when that window is scrolled to, and does not appear twice.
- [x] An override produces no graph node, and a regression test asserts it.
- [x] An override appears in no `@`-mention autocomplete result, and a
      regression test asserts it.
- [x] Overrides and exclusions are visible in the availability overlay in the
      same way ordinary occurrences are.
- [x] The excluded-starts cap is enforced with a message rather than a silent
      failure.
