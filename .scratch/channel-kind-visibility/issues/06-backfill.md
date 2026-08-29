# 06 — Backfill every conversation row

**What to build:** Every row written before ticket 05 gets its kind and
visibility filled in, so that the new columns can be trusted. A row that was
`open` becomes a public channel, one that was `closed` becomes a private
channel, and a direct message becomes a direct message whose stored visibility
is private.

That last value is inert and should be documented as such: a direct message has
no visibility to set — no roster you manage, no join request, no settings page.
The value exists only so the column can eventually be required and so indexes
need not sort around an absent value. Nothing may read it as a setting.

The backfill runs through the migrations component this project already uses,
and must be safe to re-run — a partially completed run that is restarted should
finish correctly and leave already-migrated rows exactly as they were.

**Blocked by:** 05.

**Status:** ready-for-agent

- [x] Every conversation row has both a kind and a visibility once the backfill
      reports done.
- [x] Each of the three old values maps correctly, with direct messages
      receiving a private visibility.
- [x] Re-running the backfill is a no-op on rows it has already handled.
- [x] A test drives the backfill and asserts the resulting row shape for all
      three old values.
- [x] A test asserts that a row still lacking a kind — the state during the
      widen phase — is read according to the old column, not mistaken for a
      channel.
- [x] The inertness of a direct message's stored visibility is documented at the
      migration.
- [x] The entire existing test suite passes with no test edited.

## Notes on completion

**Derived from `type` directly.** This originally went through
`isDirectMessage` / `isPublicChannel`, on the reasoning that the backfill should
not re-spell a mapping the predicates already encode. That was correct only
while those predicates read `type`. Ticket 07 pointed them at `kind` and
`visibility` — the very columns an unmigrated row lacks — and the backfill
started deriving the new columns from themselves: every row `kind: "channel"`,
every public channel private. Corrected in ticket 07, and the migration now
carries a comment explaining why it must stay on the old vocabulary.

**Added to `runAll`**, immediately after the `isPublic → type` migration it
succeeds on the same column. `runAll` executes on every deploy, which is why
the early return on already-migrated rows is load-bearing rather than tidy.

**Uses the raw builder, like the rest of this module.** Patching `kind` and
`visibility` needs no trigger: the name is unchanged so the `nodes` mirror does
not move, and the workspace aggregate counts rows rather than columns.

**The widen-phase invariant has its own test**, and it is the one worth keeping
after this is all over. It seeds a direct message the way it looked before the
widen deploy — `type` says "dm", `kind` absent — and asserts a reader still
labels it from its roster. Move any predicate onto `kind` before the backfill
and that test goes red, which is the failure it exists to catch: `undefined !==
"dm"`, so an early reader would treat every legacy conversation as a channel and
put participant names into the workspace-wide index.

**Evidence:** 1658 tests across 155 files pass; 7 in this file. No existing test
edited. Lint 5/5, 0 errors.

**Run against the dev deployment**, and verified: 3 rows processed, 0 left
missing either column, mapping confirmed as open → channel/public (x2) and
dm → dm/private.

Invoked as `convex run migrations:runBackfillChannelKindVisibility` rather than
`runAll`, to keep the write scoped to this one migration. Note that `convex dev`
does **not** run migrations — it only pushes functions. The backfill reaches a
deployment through `npm run migrate` (dev) or the `deploy` script's chained
`runAll --prod`.

**Production is untouched.** It gets the backfill from `runAll` on the next
deploy, which the deploy script already chains.
