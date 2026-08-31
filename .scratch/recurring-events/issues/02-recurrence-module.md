# 02 — The recurrence module in the shared package

**What to build:** The pure core the whole feature rests on, as a single module
in the shared package with no Convex, React, or DOM imports — the one new test
seam this feature introduces.

It answers: given a rule, a local anchor, a timezone, a duration, a set of
excluded starts and a window, which occurrences exist? It also serialises a rule
to `RRULE` text and excluded starts to `EXDATE` text, computes the truncation a
split needs, enforces the caps, and answers whether every occurrence affected by
an edit is already in the past.

Occurrences follow wall-clock time in the series' timezone — a 09:00 meeting
stays at 09:00 across a daylight-saving transition — using Temporal with
`compatible` disambiguation for gaps and repeats.

The shared package has no test runner today and gains one, following the pattern
the partykit and rsvp-worker packages already use. The duplicated client and
server copies of the historical-reschedule predicate are deleted in favour of the
one here.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Daily, weekly (including several weekdays), monthly-by-date,
      monthly-by-nth-weekday and yearly rules expand correctly over a window,
      including windows starting mid-series and windows containing nothing.
- [x] Intervals greater than one work for every frequency.
- [x] All three end kinds — end date, occurrence count, none — behave, and
      "none" is bounded by the horizon rather than running forever.
- [x] Wall-clock time survives daylight saving in both directions, verified in a
      southern-hemisphere zone as well as a northern one.
- [x] An anchor time that does not exist on a spring-forward date resolves
      forward; an anchor time that occurs twice in autumn resolves to the first.
- [x] Excluded starts remove occurrences; overrides replace them; an override
      moved outside the queried window is handled; an override whose original
      start no longer exists after a rule change is handled.
- [x] Every cap is refused rather than truncated: 24-month horizon, 366
      occurrences per window, 200 excluded starts, 10-year series span.
- [x] Rules serialise to correct `RRULE` text and excluded starts to correct
      `EXDATE` text, for every rule shape.
- [x] Split truncation is correct, including a split at the first occurrence and
      at the last.
- [x] The "every affected occurrence is in the past" predicate is correct for
      each edit scope.
- [x] The module imports nothing but Temporal, and its tests run without jsdom.
- [x] The old client and server copies of the historical-reschedule predicate
      are gone, with their call sites pointing here.
