# 11 — Tighten the columns once production is migrated

**What to build:** `kind` and `visibility` become required, and `type` leaves
the schema for good — the state ticket 10 tried to reach in one step and could
not.

This cannot ship in the same deploy as the migration that makes it safe.
`convex deploy` pushes the schema before `migrations:runAll` runs, and Convex
validates every existing document at push time, so the strict schema is only
pushable once every production row already has `kind` and `visibility` and has
lost `type`. Ticket 10's permissive schema plus `runAll` is what gets them
there.

**Blocked by:** a production deploy of the current (permissive) schema, whose
`runAll` completes `backfillChannelKindVisibility` and `stripChannelType`.

**Status:** done.

- [x] Production is confirmed to have zero channel rows missing `kind` or
      `visibility`, and zero rows still carrying `type`. Check before touching
      the schema, not after.
- [x] `kind` and `visibility` are required; `type` and `legacyChannelTypeSchema`
      are removed from the schema.
- [x] Return validators and client prop shapes drop the `| undefined`.
- [x] Both migrations stay in `runAll` — a restored backup can reintroduce the
      old shape, and they are the repair path.
- [x] The "rows that predate the split" tests are retired *in this ticket*, not
      before: once the schema forbids that shape, `convex-test` cannot seed it.
      Note in their place what they covered and why they could not survive.
- [~] A production deploy succeeds. Not yet run — this is the next push.

## Notes on completion

**Production was verified before the schema was touched**, which is the whole
point of this ticket existing separately: 3 channel rows, all `channel/public`,
none missing either column, none still carrying `type`. Counts only — the query
returned no names or ids.

Worth noting what production data does *not* prove: it holds no direct messages
and no private channels, so the backfill's `dm` and `closed` branches were never
exercised there. They were covered by tests while the legacy shape was still
constructible.

**Two mistakes made while tightening, both caught by the suite:**

A regex meant for return validators also tightened `channels.search`'s
*argument* validator. That one has to stay optional — absent means "do not
filter", not "unknown" — and the browse page sends nothing for "All". The
argument now carries a comment saying so, because it looks like an
inconsistency otherwise.

A splice intended to remove a `describe` block instead duplicated everything
after it, because the two indices it spanned were in the wrong order. The file
was rebuilt rather than patched further.

**The pre-split-row tests are retired here, not earlier.** Their note records
what they covered, that they were retired one step too early in ticket 10, and
that the safety now rests on the production check rather than on a test — a
check that has to be repeated against any deployment which has not seen the
migration, including one restored from an old backup. Both migrations stay in
`runAll` for exactly that case.

**Evidence:** 1657 convex tests across 155 files, 560 web tests, lint 5/5 with
0 errors, forced web typecheck clean, and the strict schema pushes to dev.
