# 06 — Edit scopes: this and following, and all occurrences

**What to build:** Editing a series asks what the edit applies to — *this
occurrence*, *this and following*, or *all occurrences* — in a dialog **on save**,
never as a mode chosen before editing, because choosing up front asks the
organizer to predict what they are about to change.

*This and following* is a split: the original series is truncated to end before
the chosen occurrence, and a second series is created carrying the change, the
roster, and the remaining rule. The second series is a genuinely separate
resource with its own identity.

*All occurrences* divides in two. A rule edit — recurrence, anchor, or duration —
resets every override, behind a confirmation stating how many will be reset,
because the original starts they are filed under may no longer exist. A content
edit — title, description, tags, venue, roster — leaves overrides standing and
does not propagate into them, so a renamed series can leave one occurrence
showing its old name. That is the accepted, documented behaviour.

**Blocked by:** 04.

**Status:** done

- [x] The scope dialog appears on save when editing a series, and never on a
      drag or resize.
- [x] "This and following" produces two series: the original ending before the
      chosen occurrence, and a new one carrying the change and the roster.
- [x] Occurrences before the split point are untouched; occurrences after it come
      from the new series.
- [x] A rule edit under "all" resets overrides, and the confirmation states how
      many before it does.
- [x] A content edit under "all" leaves overrides standing and does not
      propagate into them.
- [x] "This occurrence" from the edit dialog produces the same result as ticket
      04's direct path.
- [x] Splitting at the very first occurrence and at the very last both behave
      sensibly.
