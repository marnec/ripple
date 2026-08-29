# 05 — Expand: add kind and visibility beside the old column

**What to build:** The two new columns appear on the conversations table without
anything yet depending on them. **Kind** says whether a row is a channel or a
direct message; **visibility** says whether a channel is public or private. Both
are optional for now, because rows written before this ticket have neither.

Every writer starts populating all three fields, and both new columns are
exposed in return validators so that later tickets can read them from the web
app. The new index — leading with kind, then workspace, then visibility — is
added; the old one stays. Nothing is removed and nothing switches over.

**The invariant this ticket establishes, and which the next two depend on: the
old column remains the sole source of truth, and the new columns are
write-only.** A row predating this deploy has no kind, and an absent value is
not equal to "direct message" — so a reader that branches on kind too early
would hand every legacy conversation a graph node, putting participant names
into the workspace-wide index and resource search. That is a disclosure bug, not
a cosmetic one, and it is the single most likely way this migration goes wrong.
State the invariant where the person running the deploy will read it.

Note that visibility's values are not a rename of anything. The column is new,
so it is born holding *public* and *private* — the words the browse filter and,
after ticket 03, the create dialog already use. There is no value-rename step
anywhere in this plan.

**Blocked by:** 04 — the predicates are the two functions the next ticket
switches, and they must exist first.

**Status:** ready-for-agent

- [x] Both new columns exist on the conversations table as optional fields.
- [x] The new index exists, leading with kind, then workspace, then visibility.
- [x] The old column and its index are untouched.
- [x] Every path that creates a conversation — channel creation, direct-message
      creation, and any repair path — populates all three fields.
- [x] Both new columns are exposed in return validators.
- [x] The name search index carries kind and visibility as filter fields.
- [x] No reader branches on either new column; the predicates still read the old
      one.
- [x] The write-only invariant is documented where the deploy is run from.
- [x] The entire existing test suite passes with no test edited.

## Notes on completion

**Only two writers exist** — channel creation and direct-message creation. Both
now populate all three fields. A test asserts each of the three cases (public
channel, private channel, direct message) rather than trusting the diff.

**The write-only invariant is documented on the `channels` table itself**, not
in a deploy runbook, because that is where anyone about to read the new columns
is already looking. It names the concrete failure: an unbackfilled row has
`kind: undefined`, `undefined !== "dm"`, and the node trigger would therefore
give every legacy direct message a `nodes` row — putting participant names into
the workspace-wide index and resource search.

**Both columns are exposed in five return validators** — channel get, browse
search, hostable listing, the internal channel read, and the sidebar query — as
optional. Ticket 09 reads them from there.

**Verified no early readers:** every `.kind` / `.visibility` access in the
backend belongs to an unrelated discriminated union (event kinds, result kinds,
sink kinds, filter kinds). None reads a channel document. The predicates from
ticket 04 still read `type`, which is the point.

**Not yet deployed.** This is a code change; the optional columns and the new
index reach the deployment when `convex dev` / the deploy step next pushes.

**Evidence:** 1654 tests across 155 files pass. No existing test edited — the
only test-file diff in the tree is ticket 01's addition.

## Amendment (from ticket 07)

The single `["kind", "workspaceId", "visibility"]` index added here was replaced
during ticket 07 by two — `by_kind_workspace` and `by_kind_visibility_workspace`.
Querying the triple by its two-field prefix leaves `visibility` as the leading
sort key, which would have reordered the browse list. See ticket 07's notes.
