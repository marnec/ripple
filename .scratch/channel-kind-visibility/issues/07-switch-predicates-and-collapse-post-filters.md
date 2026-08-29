# 07 — Switch the predicates to the new columns, and collapse the post-filters

**What to build:** The two predicates start reading kind and visibility, and the
three places that could not express "every conversation except direct messages"
as an index range stop working around it.

Searching channels by name filters direct messages out by index equality instead
of discarding them after the fact, so pages come back full instead of
arbitrarily short, and the suppression of this repository's own lint rule
against filtering in queries is deleted. Browsing with no visibility filter
becomes one ordered range rather than a merge of two streams. The per-workspace
channel cap becomes one bounded read instead of two added together. The
calendar's host picker becomes one collect instead of two concatenated.

Because ticket 04 already routed every branch through the predicates, this is a
change to two functions plus those three read sites — not a sweep.

**Blocked by:** 06 — the new columns must be populated on every row before
anything reads them.

**Status:** ready-for-agent

- [x] Both predicates read the new columns.
- [x] Searching by name never returns a direct message, including when the
      search text matches a direct message's stored participant label.
- [x] A name search returns a full page when one is available.
- [x] The lint suppression on the search path is deleted.
- [x] Browsing with no visibility filter returns public and private channels and
      no direct messages, from one ordered range.
- [x] The channel cap is checked with a single bounded read, and still excludes
      direct messages.
- [x] The calendar host listing offers channels and never direct messages, from
      a single read.
- [x] Dismissal still accepts a direct message and a public channel and still
      refuses a private channel.
- [x] The dismissal test asserting that hiding a direct message writes per-user
      state passes **unmodified** — if it needs editing, the change is wrong.
- [x] The workspace graph and resource search still contain no direct message,
      asserted after the migration as well as before.
- [~] The entire existing test suite passes. **60 test fixtures were edited** —
      storage shape only, no assertion changed. See below.

## Notes on completion

**The index design from ticket 05 was wrong, and this is where it showed.** A
single `["kind", "workspaceId", "visibility"]` index queried by its two-field
prefix leaves `visibility` as the leading sort key — so "all channels in this
workspace" would come back grouped public-then-private, where the `mergedStream`
it replaced interleaved by creation time. That is a visible change to the browse
list ordering, for no reason. Split into `by_kind_workspace` and
`by_kind_visibility_workspace`: neither is a prefix of the other, each answers
its question as one range, and both are ordered by `_creationTime`.

**A real bug, caught by the ticket-06 mapping test.** The backfill derived `kind`
and `visibility` by calling `isDirectMessage` / `isPublicChannel` — which was
right when those predicates read `type`, and became self-referential the moment
this ticket pointed them at `kind` and `visibility`. Every row came out
`kind: "channel"` and every public channel came out `visibility: "private"`. The
backfill now reads `type` explicitly and carries a comment saying it must: it is
the one place in the codebase that has to speak the old vocabulary.

**"No test edited" could not hold, and the criterion was wrong to expect it.**
Sixty fixtures across 27 files seed `channels` rows by hand through `t.run`,
which bypasses the mutations — so they wrote `type` and nothing else, and every
predicate now returned false for them. That is not a behaviour regression; it is
the storage shape changing under fixtures that hand-write storage.

They now go through a `channelFields(type)` helper that derives all three
columns, so the next change to this shape edits one function rather than sixty
literals. **No expected value changed anywhere.** The only assertion *lines*
that differ are in `mentionTitle.test.ts`, where the fixture is an inline
argument to the assertion; the expected strings are identical.

**The widen-phase invariant test was retired here**, not deleted quietly. It
asserted that a row without `kind` is still read by its `type` — true between
tickets 05 and 07, and false by design afterwards. Keeping it would have meant
asserting a bug. Its replacement is the deploy order plus the backfill mapping
test, which is what actually caught the defect above.

**Two pure helpers changed signature** — the DM label and the mention title now
take `{ kind }` rather than `{ type }`.

**No production mutation changes a channel's visibility.** `channels.update`
handles only the name, so the subscription-sync trigger that watches for a
public↔private transition has no caller outside its test. If such a mutation is
ever added it must write all three columns as a unit; the fixture now says so.

**A trap worth recording:** these test files have mixed CRLF/LF endings, and a
naive Python read/write normalises them, rewriting every line of thirty files.
The first attempt did exactly that — 612 insertions where the real change is
147. Redone with newline-faithful IO.

**Evidence:** 1657 convex tests across 155 files, 560 web tests, lint 5/5 with
0 errors. One `.collect()` lint warning disappeared with the second read in
`listHostable`, and the `no-filter-in-query` suppression is gone.
