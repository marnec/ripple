# Split the channel type enum into kind and visibility

> Status: ready-for-agent. Unit two of two. Depends on spec 0001 only for the
> create-channel validator narrowing, which spec 0001 delivers.
> Decision record: ADR 0001.

## Problem Statement

A `channels` row carries one flat enum saying it is `open`, `closed`, or `dm`.
That single column answers two unrelated questions at once: *what kind of thing
is this* — a configurable **channel**, or a **direct message** — and *who may
enter it* — public, or private. Because the two are fused, no query can ask one
without accidentally asking the other.

The concrete cost is that "every conversation except direct messages" is not
expressible as an index range. A text search index filters by whole-value
equality only, so searching channels by name has to fetch direct messages and
discard them afterwards, which can return short or empty pages and required
suppressing the repository's own lint rule against filtering in queries. The
same impossibility forces the browse listing to merge two separate index ranges
rather than read one, the per-workspace channel cap to perform two bounded reads
and add them together, and the calendar's host picker to collect two ranges and
concatenate them. Three post-filters and a lint suppression, all descended from
one column.

The fusion is also a correctness hazard that has nothing to do with performance.
Roughly forty places in the codebase branch on this column, and each of them
means either "is this a direct message" or "is this private" — but the column
cannot tell them apart, so neither can a reader. Dismissal is the worked
example: it refuses to hide a `closed` channel, and direct messages *are*
hideable. Anyone who reads that check as "refuse to hide private things" will
silently break closing a conversation.

## Solution

Split the column in two, on the same table. A `kind` says whether a row is a
**channel** or a **direct message**. A `visibility` says whether a **channel** is
**public** or **private**. Direct messages are not a third visibility; they have
none, and the value stored on their rows is a derived constant rather than a
setting.

Indexes lead with `kind`, so "browsable conversations in this workspace" becomes
one range and one equality filter. The three post-filters and the lint
suppression delete.

Every branch on the old column is re-asked: does this mean kind, or does it mean
visibility? They are not interchangeable, and the old column's inability to
distinguish them is what this change exists to remove.

Separately, the per-user feature that drops a conversation out of one person's
sidebar is renamed to **dismissal**, because it currently occupies the word
"visibility" that this change gives a precise and different meaning.

## User Stories

1. As a workspace member searching channels by name, I want results never to
   include direct messages, so that a private conversation cannot surface in a
   browse listing.
2. As a workspace member searching channels by name, I want a full page of
   results, so that pages are not silently shortened by rows discarded after the
   fact.
3. As a workspace member browsing all channels, I want the listing to read one
   ordered range, so that pagination is a straight read rather than a merge of
   two streams.
4. As a workspace member filtering the browse page to public or private, I want
   the filter to be answered by an index, so that it stays fast as the workspace
   grows.
5. As a workspace member creating a channel, I want the per-workspace cap
   checked with one bounded read, so that creating a channel does not get slower
   as direct messages accumulate.
6. As a workspace member, I want direct messages to remain excluded from the
   channel cap, so that talking to colleagues never consumes the workspace's
   channel budget.
7. As a workspace member scheduling a calendar event, I want the "hosted in"
   picker to offer channels and never direct messages, so that a meeting cannot
   be attached to someone else's conversation.
8. As a workspace member, I want the sidebar to keep listing every public
   channel plus the private ones and conversations I belong to, so that the
   split changes nothing about what I can see.
9. As a workspace member, I want to still be able to close a direct message, so
   that the rename of the privacy axis does not take away conversation
   dismissal.
10. As a workspace member, I want a closed direct message to reappear when a new
    message arrives, so that dismissal remains a pause rather than a deletion.
11. As a workspace member, I want to still be unable to dismiss a private
    channel, so that leaving remains the way out of a channel I was invited to.
12. As a workspace member, I want to still be able to dismiss a public channel,
    so that I can decline one I was never a member of.
13. As a workspace member, I want dismissal to remain per-user and to follow me
    across devices, so that closing a conversation on one device closes it on
    all of them.
14. As a workspace member, I want direct message names to stay out of the
    workspace graph and resource search, so that a conversation's participants
    are not disclosed by a workspace-wide index.
15. As a workspace member, I want notification fan-out to reach exactly the
    people it reaches today, so that the split does not silently stop
    subscriptions.
16. As a workspace member, I want my unread counts, reads, mentions, calls, and
    presence to work identically for channels and direct messages, so that the
    split is invisible in daily use.
17. As a workspace member, I want deleting a workspace to still remove every
    channel and conversation in it, so that the cascade is unaffected.
18. As a workspace member, I want a direct message to remain impossible to
    rename, to gain a third member, or to receive a join request, so that its
    fixed shape is preserved.
19. As a workspace member with a browser tab open across the deploy, I want the
    worst outcome to be a reload, so that a stale tab is an inconvenience rather
    than a data problem.
20. As a developer, I want a stored value that says `public` or `private`, so
    that the database, the create form, and the browse filter finally use one
    vocabulary.
21. As a developer, I want the browse code to stop suppressing the lint rule
    against filtering in queries, so that the suppression's absence is itself a
    guarantee.
22. As a developer, I want every branch on the old column to be individually
    re-decided as kind or visibility, so that the conflation is not carried
    forward into the new columns.
23. As a developer, I want it to be unrepresentable for a row to claim to be a
    channel and a direct message at once, so that the two columns cannot drift
    apart.
24. As a developer, I want the migration to run in phases where rows that
    predate it are still read correctly, so that the backfill is not a window of
    wrong answers.
25. As a developer, I want no reader to branch on the new columns until the
    backfill has finished, so that an unbackfilled direct message is never
    mistaken for a channel.
26. As a developer, I want the per-user dismissal module named for what it does,
    so that "visibility" means one thing in this codebase.
27. As a developer, I want the dismissal column left alone, so that two
    migrations are not in flight over the same feature at the same time.
28. As a developer, I want the decision and its rejected alternatives recorded,
    so that nobody proposes a separate direct-messages table in six months.
29. As a developer, I want the domain glossary to define kind, visibility, and
    dismissal, so that the next person to touch this reaches for the right word.

## Implementation Decisions

**Two columns on one table, not two tables.** Direct messages and channels share
messages, calls, reads, mentions, presence, the channel-membership table, and
the channel access rule. Splitting the table forks every one of those to buy a
distinction one column already makes. Recorded, with the rest of the rejected
alternatives, in ADR 0001.

**`kind` is `channel` or `dm`; `visibility` is `public` or `private`.** The
non-DM kind is called `channel` even though every row lives in the channels
table, because that is the word the sidebar, the browse page, and the users
already use. Not a boolean: a boolean is what the column was two migrations ago,
and a future group conversation is plausible enough that the enum earns its
keep.

**Direct message rows store `visibility: "private"`, and that value is inert.**
It exists so the column can be required and so indexes need not sort around an
absent value. Nothing may read it as a setting; a direct message has no
visibility to set. This is the one deliberate imprecision in the model and it is
recorded in both the glossary and the ADR.

**The stored values are renamed to `public` / `private` in the same migration.**
The earlier decision to keep `open` / `closed` and translate at the UI was
correct only while no migration was happening; once every row is being rewritten
anyway, keeping the old words would ship a column named `visibility` holding
`open` — a third vocabulary inside the change that exists to eliminate the
second one. The label map introduced by spec 0001 collapses to identity and is
deleted.

**One index replaces the type-and-workspace index:** `kind`, then `workspaceId`,
then `visibility`. Its two-column prefix answers "every browsable conversation in
this workspace" and "every direct message in this workspace"; the full triple
answers "every public channel in this workspace". The workspace-only index stays
— the workspace deletion cascade traverses it. The name search index's filter
fields become workspace, kind, and visibility, which is what allows the
after-the-fact exclusion of direct messages to be replaced by an equality
filter.

**Every branch on the old column is re-decided individually.** The rule is: does
this site mean *kind* or *visibility*? Dismissal is the canonical example — it
rejects private channels but must keep accepting direct messages, so its
predicate becomes "a direct message, or a public channel", with the kind check
first. The notification subscription synchronisation code is the highest-risk
pair of sites, because a fan-out that quietly stops reaching people produces no
error.

**Three deploys, widen then migrate then narrow.** Deploy one adds both columns
as optional, adds the new index, and makes every writer populate all three
fields. Deploy two runs the backfill through the migrations component already
used by this project. Deploy three makes the columns required, drops the old
column and its index, and sweeps every reader.

**During the widen phase the old column is the sole source of truth, and the new
columns are write-only.** No reader may branch on `kind` before the backfill
reports done. A row predating deploy one has no `kind`, and an absent value is
not equal to `dm` — which would hand every legacy direct message a graph node,
putting participant names into the workspace-wide index and resource search.
That is the single most likely way this migration goes wrong, and it is a
disclosure bug rather than a cosmetic one. The invariant belongs in the
migration's own documentation, where the person running it will read it.

**Deploy three's removal of the old column from return validators will break
already-open browser tabs** until they reload, because old client code reads a
field the server no longer returns. Accepted, rather than carrying a derived
compatibility field for one release — a shim whose removal never happens. The
failure mode is a stale tab rendering a conversation slightly wrong.

**The per-user dismissal module and its mutations are renamed** to speak of
dismissing and restoring rather than hiding, so that "visibility" has exactly
one meaning. The stored column keeps its current name: renaming it is a second
migration on a second table, concurrent with the first, which is the one
reliable way to turn two safe migrations into one unsafe one. User-facing
strings are unchanged — "Close conversation" and "Show N hidden" are each
correct in their own context and neither says "visibility".

## Testing Decisions

**What makes a good test here.** Tests assert what callers observe: which rows
come back from which query, which mutations refuse which arguments, which rows
exist after a migration runs. They do not assert which index served a query.
Where a decision's whole point is that an index serves it, the observable proxy
is the result set and its completeness — a full page, the right exclusions —
not the query plan.

**One seam: the Convex function surface**, through `convex-test`, using the
existing workspace-and-admin setup helpers. The backfill is reached at the same
seam by invoking the migration directly, as several existing tests already do
for other migrations. No new seam is introduced, and none is needed: every
behaviour this spec changes is observable from a function call.

**Modules under test:** dismissal, channel search and browse, channel creation
and its cap, the calendar host listing, the workspace sidebar data, the graph
node trigger, and notification subscription synchronisation. Plus the backfill
migration itself.

**The single most important test already exists.** The dismissal test asserting
that hiding a direct message writes per-user state is precisely the guard
against the kind-versus-visibility trap described above. It must survive this
change unmodified. If a sweep makes it fail, the sweep is wrong; if a sweep
makes it need editing, that edit needs justifying.

**Existing coverage that must keep passing unchanged**, as the primary evidence
the split is behaviour-preserving: the dismissal suite in full, including
auto-restore on a newer message, the refusal for private channels, and the
sidebar filtering; the channel cap suite, including that direct messages do not
count and that a capped workspace can still start one; the create-DM suite,
including deduplication and the refusals to rename or add members; the resource
search suite; the workspace graph suite; and the workspace cascade delete suite.

**New coverage:**
- Searching by name never returns a direct message, including a search whose
  text matches a direct message's stored participant label, and returns a full
  page when one is available.
- Browsing with no visibility filter returns public and private channels and no
  direct messages, in one ordered page.
- The backfill assigns kind and visibility correctly for each of the three old
  values, is idempotent when re-run, and leaves already-migrated rows untouched.
- A row with no kind yet — the unbackfilled state — is still treated as its old
  column says, for the readers that run during the widen phase.
- The graph node trigger creates no node for a direct message, asserted after
  the migration as well as before.
- Dismissal accepts a direct message and a public channel and refuses a private
  channel, restated against the new columns.

**Prior art:** the dismissal suite is the model for asserting per-user state and
sidebar filtering; the channel cap suite for index-range counting; the resource
search suite for search exclusions; the workspace graph suite for trigger
side-effects; and the existing tests that invoke migration functions for the
backfill.

## Out of Scope

- Anything in spec 0001: the dialog split, the DM entry point, the labels.
- Renaming the dismissal column. The module and its functions are renamed; the
  stored field is not.
- Moving dismissal to client storage. It is per-user but cross-device, its
  auto-restore is a server-side comparison against message timestamps, and it is
  a query filter rather than a render decision.
- Group direct messages. The enum is chosen so they remain addable later; none
  are added here.
- Any change to the channel access rule, the join request flow, or channel
  membership.
- Any change to what a direct message's label is or how it is derived.
- Backfilling or reshaping any table other than channels.

## Further Notes

The performance wins are real but they are not the reason to do this. The reason
is the forty branch sites that each mean one of two things and cannot say which.
The post-filters and the lint suppression are symptoms of that, and they are
worth mentioning mainly because they are the part a reviewer can see in the diff.

The riskiest hour of this work is the widen phase, and the risk is not
downtime — it is a reader that starts trusting a column before the backfill has
filled it. Whoever runs deploy one should be able to state, without looking,
which column is authoritative at that moment.
