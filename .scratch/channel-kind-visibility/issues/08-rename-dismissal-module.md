# 08 — Rename the per-user dismissal module

**What to build:** The feature that drops a conversation out of one person's own
sidebar is named **dismissal**, not visibility. It currently occupies the word
that ticket 05 gives a precise and entirely different meaning — visibility is a
property of a channel, identical for everyone who can see it, while this is a
property of one member's view and belongs to nobody else.

The module and its two mutations are renamed to speak of dismissing and
restoring. The stored column keeps its current name: renaming it means a second
migration, on a second table, running concurrently with the first — the one
reliable way to turn two safe migrations into one unsafe one. It is read in
three places and appears in no user-facing string, so the rename would buy
consistency somewhere nobody looks.

Every user-facing string is unchanged. "Close conversation" and "Show N hidden"
are each correct in their own context, and neither says "visibility".

**Blocked by:** 04 — this module's predicate is one of the decisions that ticket
makes, and both tickets touch the same code.

**Status:** ready-for-agent

- [x] The module and both mutations are named for dismissing and restoring.
- [x] The stored column name is unchanged.
- [~] No user-facing string changes, with one deliberate exception — the
      rejection message said "Closed channels". See below.
- [x] The word "visibility" no longer refers to per-user view state anywhere in
      the codebase.
- [~] The existing dismissal test suite passes in full. Its call sites moved
      with the rename; **no expectation changed**. See below.

## Notes on completion

**What was renamed:** the module (`channelVisibility` → `channelDismissal`),
both mutations (`hideChannel` → `dismissChannel`, `unhideChannel` →
`restoreChannel`), the test file alongside it, and the four client call sites in
the sidebar. The stored `hiddenAt` column is untouched, as planned.

**What was deliberately *not* renamed:** the web app's `channelVisibility` in the
browse filter, `use-debounced-search` and `ResourceListPage`. That one refers to
the genuine public/private axis and is correctly named — renaming it would have
been the mistake this ticket exists to correct, in reverse.

**One user-facing string did change.** The rejection read "Closed channels
cannot be hidden; leave the channel instead" — and "Closed" is exactly the word
ticket 03 removed from every visible surface. It now reads "Private channels
cannot be dismissed". The test asserting it matches only the tail, "leave the
channel instead", so no expectation moved. The message is defensive anyway: the
sidebar offers "Leave channel" rather than dismissal for a private channel, so
it is not reachable through the UI.

**The test suite's call sites moved with the rename**, which is unavoidable when
the thing being renamed is the public API they call. No expectation changed —
verified by diffing for changed assertion lines. The `describe` labels follow
the new names.

**The module docstring was rewritten in the new vocabulary**, and now states
what dismissal *is* rather than enumerating channel types: the only way to
decline a public channel, the whole lifecycle of a direct message, and refused
for private channels, which are left instead.

**A self-inflicted bug worth noting:** replacing `hideChannel(` before
`unhideChannel(` turned the latter into `undismissChannel(`. Caught by
typecheck, not by tests — the client call sites have no test coverage.

**Evidence:** 1657 convex tests across 155 files, 560 web tests, lint 5/5 with
0 errors.
