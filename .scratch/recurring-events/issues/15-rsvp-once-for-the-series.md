# 15 — RSVP once, for the whole series

**What to build:** An invitee answers once and the answer holds for every
occurrence. The RSVP control appears both on the series itself and on any
occurrence opened from the calendar — the occurrence is where people actually
land, so requiring them to find the series first would make answering harder
than the one-off case it replaces.

What they are answering is always the series. There is no "I can't make this
Tuesday": per-occurrence RSVP is deliberately out of scope, and the roster row
is already shaped to accept it later without a migration.

The series-level RSVP mutation exists and is tested; nothing in the app calls
it.

**Blocked by:** 14.

**Status:** done

- [x] An invited member sees an RSVP control on the series and on any of its
      occurrences, and answering from either records the same answer.
- [x] The answer is visible to the organizer on the roster, and to the invitee
      wherever they look at the series.
- [x] Answering once applies to every occurrence, including ones created by the
      rule after the answer was given.
- [x] Someone who is not on the roster is offered no RSVP control and is
      refused if they try.
- [x] An occurrence that has been moved or edited shows the same series-level
      answer as the rest.

**How.** One hook, `use-series-rsvp.ts`, is the whole feature: it reads the
series' roster, finds the viewer's row, and calls `eventSeries.respond` with a
`seriesId` and nothing else. Four surfaces mount it — the series page, an
occurrence, and the two that render an **override** (`EventDetailPage` and the
sheet the dashboard calendar opens) — so "the same answer wherever it is
given" holds by construction rather than by four call sites agreeing.

`RsvpResponseGroup` gained `aria-pressed`, which is both how the recorded
answer reaches a screen reader and what makes "shows the same answer" a thing
a test can see.

One backend change was needed to make the last box true. A moved occurrence
becomes an override — a `calendarEvents` row with no invitee rows of its own —
and `calendarEvents.listMineInRange` asked only that row who was coming, so
the moved Tuesday was on nobody's calendar but the organizer's. It now also
asks the series' roster (`isOnCallersCalendar`), which is the same rule
`cancel` already applies when it announces an override's removal.
