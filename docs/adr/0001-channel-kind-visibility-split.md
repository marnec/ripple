# Split `channels.type` into `kind` and `visibility`

> Status: accepted, not yet implemented. Consequences are written in the past
> tense because that is how they will read once the migration has run; until
> then they are the constraints the migration must satisfy.

`channels.type` was one flat enum — `open | closed | dm` — conflating two
unrelated axes: *what a row is* (a configurable channel, or a direct message)
and *who may enter it* (public, or private). We split it into `kind:
"channel" | "dm"` and `visibility: "public" | "private"`, keeping both columns
on the same `channels` table.

## Considered Options

**Two tables (`channels` and `directMessages`) — rejected.** This is the
alternative a future reader will assume we didn't consider, so: DMs and channels
share almost everything that matters. Messages, calls, reads, mentions, presence,
`channelMembers`, and `requireChannelAccess` are all keyed by `channelId`, and
the channel access rule (open channels are workspace-readable; closed and dm
require a `channelMembers` row) is one rule covering both. Splitting the table
would fork every one of those, and buy a distinction that one column already
makes.

**Leaving the flat enum — rejected.** "Any type except dm" is not expressible in
an index. A Convex search index's `filterFields` do whole-value equality, so
`channels.search` post-filtered DMs out of a text search; the same impossibility
forced a two-range `mergedStream` in `search`, a double `.take()` in the channel
cap in `create`, and a double `.collect()` in `listHostable`. All three exist
only because "open + closed" could not be one index range. With `kind` they
become one range and one `.eq()`.

**Adding `kind` while leaving `type` as-is — rejected.** It would make
`kind: "channel", type: "dm"` representable: two columns able to disagree about
one fact, with nothing enforcing agreement. That is the failure this change
exists to remove, not a cheaper way to get it.

## Consequences

**A DM stores `visibility: "private"`, and that value is a lie of convenience.**
A DM has no visibility to set — no roster you manage, no join request, no
settings page. The value is a derived constant, present only so the column can
be required and indexes need not sort around `undefined`. Nothing may treat it
as a setting.

**Every `type === "dm"` site had to be asked which axis it meant.** The two are
not interchangeable and the old column could not tell them apart.
`channelVisibility.hideChannel` is the worked example: it rejected
`type === "closed"`, and DMs are hideable. Rewritten as
`visibility === "private"` it would have silently killed "Close conversation"
for every DM. The correct predicate is *`kind === "dm"` or
`visibility === "public"`*.

**During the widen phase, `type` remained the sole source of truth.** Rows
predating the migration have `kind: undefined`, and `undefined !== "dm"` would
have handed every legacy DM a `nodes` row — putting DM names into the workspace
graph and `nodes.search`, which is a data leak rather than a cosmetic bug. The
new columns were write-only until the backfill reported done.

**Deploy 3 dropped `type` from return validators, breaking already-open browser
tabs** until they reload. Accepted over a fourth deploy carrying a derived
`type` for one release — a compatibility shim whose removal never happens.

**`git grep` for `"open"` / `"closed"` does not span the cutover.** The stored
values were renamed to `"public"` / `"private"` to match the words the UI had
already been using in the browse filter, rather than leaving a column named
`visibility` holding `"open"`.
