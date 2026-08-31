# 05 — Custom rule editor and limit refusals

**What to build:** The escape hatch behind *Custom…*: an interval ("every two
weeks"), a choice of monthly mode where it applies, and an end that is a date,
an occurrence count, or never. The form tells the organizer how many occurrences
the rule will produce before they save it, so a mistake is caught before fifty
invitations go out, and a rule that exceeds a limit is refused with an
explanation naming which limit and why.

Keeps the default path untouched: someone booking a one-off never sees a rule
editor, and the four presets need no configuration.

**Blocked by:** 03.

**Status:** done

- [x] *Custom…* opens a dialog for interval, monthly mode, and end kind, and
      cancelling it leaves the previously chosen preset intact.
- [x] All three end kinds are settable and round-trip through save and reopen.
- [x] The form shows an accurate occurrence count (or "no end") for the current
      rule, updating as the rule changes.
- [x] A rule exceeding the series-span, per-window, or horizon limit is refused
      at save with a message naming the limit — never truncated.
- [x] Choosing *Never* produces a genuinely open-ended series from the
      organizer's point of view, with no renewal prompt.
- [x] The preset derivation from a chosen date (which weekday, which nth
      weekday) is unit-tested at the existing web-utils seam.
