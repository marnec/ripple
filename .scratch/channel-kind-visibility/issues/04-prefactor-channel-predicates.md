# 04 — Prefactor: every branch on channel type goes through a predicate

**What to build:** Two predicates — "is this a **direct message**" and "is this
a private **channel**" — and every place in the codebase that branches on a
conversation's type routed through one of them. No schema change, no behaviour
change, no user-visible difference; every existing test passes untouched.

This is the ticket that does the actual thinking. Around forty sites branch on
the current column, and each of them means one of two unrelated things: *what
kind of thing is this*, or *who may enter it*. The column cannot tell them
apart, so today neither can a reader. Going through the sites while **both
readings still produce the same answer** means each decision can be made and
reviewed in isolation, with a green test suite proving nothing moved. Doing this
work during the migration instead would mix "which axis did this mean" with
"which column does this read" in one diff, and the first question is the one
that has correctness riding on it.

Dismissal is the worked example and the reason this ticket exists. It refuses to
hide a `closed` conversation, and direct messages *are* hideable — so the naive
reading, "refuse to dismiss private things", silently breaks closing a
conversation. The predicate it needs is *a direct message, or a public channel*,
with the kind check first. The notification subscription synchronisation sites
are the highest-risk pair, because fan-out that quietly stops reaching people
produces no error anywhere.

Afterwards, the schema migration changes two functions instead of forty.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [x] Two predicates exist, one per axis, and every branch on a conversation's
      type in the backend goes through one of them.
- [x] Each converted site is a deliberate answer to "kind, or visibility?" — not
      a mechanical substitution of one expression for another.
- [x] Dismissal's predicate is "a direct message, or a public channel" — kept in
      its refusal form, `!isPrivateChannel`. See the note below.
- [x] Both notification subscription synchronisation sites are converted and
      their existing coverage still passes.
- [x] The graph node trigger, the sidebar data query, the browse and search
      paths, the channel cap, the calendar host listing, and the label
      derivation are all converted.
- [x] No schema change, no index change, no return validator change.
- [x] The entire existing test suite passes with no test edited.

## Notes on completion

**Three predicates, not two.** The kind axis needs one; the visibility axis
needs two, because `isPublicChannel` and `isPrivateChannel` are *not*
negations of each other — both are false for a direct message. That is the
whole safety property. A single visibility predicate would have forced every
site to express one of the two cases as a negation, which is exactly how a
direct message gets swept into "private" by accident.

**They live in the shared package, not in the backend.** Ticket 09 has to make
the same forty decisions on the client, and the answers must agree. The
predicates take `{ type: string }` so they accept both a stored document and
the DTOs the web app receives.

**Dismissal kept its refusal form.** This ticket asked for the positive
predicate — "a direct message, or a public channel". The code now reads
`if (isPrivateChannel(channel)) throw`, which is its exact negation given that
`isPrivateChannel` is false for a direct message, and it matches the error
message the caller sees. The guard against the trap has moved into the
predicate's *definition*, where it holds for every site at once, rather than
being restated at this one call site.

**Three membership gates and two access gates read `!isPublicChannel`.** Those
sites mean "requires a `channelMembers` row" — true for private channels and
direct messages alike. Written as the negation of the public predicate rather
than as a fourth named predicate, because the rule is the negation.

**Not converted, deliberately:** index lookups (`q.eq("type", …)`) and return
validators. Those are not branches; they change in tickets 05 and 07. Also
`migrations.ts`'s `channel.type !== undefined` guard, which belongs to the
older `isPublic → type` migration and asks whether a row has been migrated at
all, not which type it is.

**Evidence:** 1651 tests across 154 files pass. The only test-file change in the
working tree is ticket 01's addition; no existing test was edited.
