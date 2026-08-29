# 10 — Contract: drop the old column

**What to build:** The old type column and its index are removed, and the two
new columns become required. After this ticket, a row that claims to be both a
channel and a direct message is unrepresentable — which is the entire point of
the split, and the thing that could not be guaranteed while both forms existed
side by side.

The workspace-only index stays; the workspace deletion cascade traverses it. The
label map introduced by ticket 03 collapses to plain capitalisation, since the
stored words and the displayed words are now the same words.

One accepted cost: removing the old column from return validators breaks browser
tabs that were already open across the deploy, because their code reads a field
the server no longer sends. They recover on reload. The alternative — carrying a
derived compatibility field for one release — means a fourth deploy and a shim
whose removal never happens, to avoid a stale tab rendering a conversation
slightly wrong until refresh.

**Blocked by:** 07, 08, 09.

**Status:** ready-for-agent

- [x] Both new columns are required.
- [x] The old column is removed from the table, from every return validator, and
      from the shared type vocabulary.
- [x] The old index is dropped; the workspace-only index remains and the
      workspace deletion cascade still removes every conversation.
- [x] The label map is reduced to capitalisation, or deleted if nothing needs it.
- [x] Unread counts, reads, mentions, calls and presence behave identically for
      channels and direct messages.
- [x] A direct message still cannot be renamed, cannot gain a third member, and
      still refuses a join request.
- [x] The entire existing test suite passes.

## Notes on completion

**This ticket was two deploys, not one, and the reason is not negotiable.**
Convex validates *existing documents* when a schema is pushed, so `type` cannot
leave schema.ts while any row still carries it. The sequence was: declare it
`v.optional` and add `stripChannelType`, push, run the strip, then delete the
column and push again. Both pushes ran against the dev deployment; the second
one succeeding is itself the proof the strip worked, since it would have failed
validation otherwise.

**Verified on real data**, not only in tests: all three rows carry `kind` and
`visibility` and none carries `type`; `by_kind_workspace` returns both channels
as one range; `by_kind_visibility_workspace` returns the public ones; and the
name search returns channels with the DM excluded by an equality filter.

**The arguments changed too, not just the columns.** `channels.create` now takes
a `visibility`, so a direct message is not something the call can express —
ticket 01's runtime guard has been replaced by the type system, and its test is
retired with a note pointing at what still covers the invariant.
`channels.search` takes a `visibility` as well, which deleted the last
translation in the web app: the browse filter's own values now pass straight
through.

**`ChannelType` did not survive.** It was the enum that conflated the two axes,
and its last consumers were the two repair migrations. Rather than keep it in
the shared vocabulary for their sake, the retired literals now live as a local
constant in `migrations.ts`, where the only code that reads them is.

**Two migrations are now untestable, and that is the expected end state.**
`backfillChannelKindVisibility` and `stripChannelType` both need a fixture in a
shape the schema no longer describes, and `convex-test` validates inserts
against the live schema at runtime — `as never` silences the compiler, not the
validator. `migrateChannelIsPublicToType` has never had tests for the same
reason. All three stay in `runAll` because a restored backup can reintroduce the
old shape. The retired tests earned their keep first: the mapping test caught a
real defect during ticket 07.

**A gap worth knowing about:** `apps/convex`'s lint is `tsc`, and it does not
cover `tests/`. Fixtures referencing the deleted `ChannelType` typechecked
clean and failed at runtime instead. The suite caught them, but nothing earlier
would have.

**Evidence:** 1653 convex tests across 155 files, 560 web tests, lint 5/5 with
0 errors, and a forced (non-incremental) web typecheck — `tsc -b` is
incremental and reported a false pass mid-ticket until `--force`.

## Correction — the production deploy failed

The guidance above was wrong, and CI proved it. It said production needed "two
pushes in the same order, with `runAll` between them". But the deploy script is
`convex deploy && convex run migrations:runAll --prod`: **the schema is pushed
before the migrations run, in one job**. Convex validates every existing
document at push time, so a schema requiring `kind` can never reach a deployment
whose rows lack it — the migration that would add it ships in the same push.
There is no push order that works. It failed on a real row:
`{name: "italia 1", type: "open", workspaceId: …}`.

This worked on dev only because dev had been widened and backfilled in an
earlier session, so its rows were already clean by the time the strict schema
arrived. That is exactly the trap of verifying a migration against a deployment
you have already migrated by hand.

**The fix: one permissive schema instead of a strict one.** All three columns
are `v.optional`, which accepts every row shape at once — pre-split (`type`
only), mid-migration (all three), post-strip (`kind` + `visibility`). A single
deploy lands, and `runAll` then walks every row to the final shape in order:
`migrateChannelIsPublicToType` → `backfillChannelKindVisibility` →
`stripChannelType`.

**Tightening is a *later* deploy**, and only once production rows are known
clean. That is ticket 11.

**The regression test is the important artifact.** `channelKindVisibility.test.ts`
now seeds a row in the pre-split shape and asserts it can exist at all. The
tests retired in this ticket — on the grounds that a legacy row was no longer
constructible — were retired one step too early: making them unconstructible is
precisely what broke the deploy. They are back, plus a strip-and-idempotency
case.
