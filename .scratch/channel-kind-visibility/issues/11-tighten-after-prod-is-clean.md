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

**Status:** blocked — do not start until production data is verified clean.

- [ ] Production is confirmed to have zero channel rows missing `kind` or
      `visibility`, and zero rows still carrying `type`. Check before touching
      the schema, not after.
- [ ] `kind` and `visibility` are required; `type` and `legacyChannelTypeSchema`
      are removed from the schema.
- [ ] Return validators and client prop shapes drop the `| undefined`.
- [ ] Both migrations stay in `runAll` — a restored backup can reintroduce the
      old shape, and they are the repair path.
- [ ] The "rows that predate the split" tests are retired *in this ticket*, not
      before: once the schema forbids that shape, `convex-test` cannot seed it.
      Note in their place what they covered and why they could not survive.
- [ ] A production deploy succeeds.
