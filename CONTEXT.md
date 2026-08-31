# Ripple

Real-time collaborative workspace (Convex backend + React/Vite frontend). This
file is the project glossary: the opinionated names for concepts specific to
Ripple. General programming concepts don't belong here.

## Language

**Headless editor**:
A BlockNote editor created server-side under a transient JSDOM shim, with no
React/UI, used to convert markdown into the structures the client renders —
BlockNote JSON or a Yjs snapshot. Lives in `convex/lib/headlessEditor.ts`; uses
`@blocknote/core` (never `@blocknote/server-util`, which blows Convex's node
bundle ceiling).
_Avoid_: server-side editor, markdown converter, blocknote helper

**Seeding**:
Producing a collaborative document's initial content server-side, before any
client connects — by writing the **cold-start snapshot** rather than editing a
live document. Used for transcripts, task descriptions seeded from issue bodies,
and inbound comments.
_Avoid_: prefilling, initializing, importing

**Cold-start snapshot**:
The binary Yjs update (V1 `encodeStateAsUpdate`) stored in `_storage` that a
collaborative editor hydrates from on first load (via PartyKit's `onLoad`). The
artifact [seeding](#) produces.
_Avoid_: initial state, dump, backup

**Hydrated replica**:
A client Y.Doc that holds the room's state, because a sync completed, because
the IndexedDB cache replayed something, or because the
[cold-start snapshot](#) was merged into it. Its opposite — an **unhydrated**
replica — is an empty Y.Doc that is empty only because nobody has told it
anything; Yjs cannot tell the two apart, so `useCollaborativeDoc` carries
`isHydrated` alongside the document. No editing surface may bind to an
unhydrated replica: authoring into one creates a structure that competes with
the real document instead of merging into it.
_Avoid_: loaded, synced doc, warm doc, has content

**Room store**:
A small key/value store scoped to one collaborative room, living in the
`custom` object store of that room's IndexedDB database — the one y-indexeddb
opens for the Yjs cache and never writes to itself. Holds what the server told
us *about* a resource (its name, its tags) beside the resource's content, so
the two are evicted together and can never disagree about what this device
knows. Reached through `CollaborativeDoc.roomStore`, read through
`useRoomCached`; null for a guest, whose device keeps no cache at all.
_Avoid_: metadata cache, local storage, offline store

**Collaborative surface**:
One collaborative room — a document, diagram or spreadsheet — presented through
one **opening sequence**: rule out deletion, refuse an [unhydrated replica](#)
nothing can reach, hold reserved space while the room is still reachable, then
hand the hydrated replica to the body. The body is a child of the sequence
rather than a caller of it, so there is no way to bind an editing surface to a
replica whose contents are unknown.
The sequence takes the *open room*, not the credential for opening it: members
pass `useResourceDoc` and guests `useGuestDoc`, two adapters at the
`CollabSession` seam. It used to open the room itself and own the member header
too, and that is what kept guests out — the header needs a workspace and a live
server, so admitting a guest would have meant admitting a caller it could not
serve. The header is `SurfaceHeader`, rendered by members as the first child of
the sequence; the rule it carries is that controls which would *change* the
resource are offered only while the server is answering, while tools that work
against the local copy are not gated. A guest gets no `SurfaceHeader` — their
chrome is the share's own header in `GuestResourceView`, which is also where a
guest's room is opened and where their deletion story is told (the share goes
`not_found`, so the sequence's deleted stage never fires for them).
A task's description is not a surface: it has no header and no settings route,
so it opens its own room.
_Avoid_: editor page, doc view, resource page, resource shell

**Connection policy**:
How a collaborative room decides whether to keep trying, as a pure reducer
(`collab/connection-policy.ts`): `reduceConnection(state, event)` returns the
next state *and* a list of **connection effects** — clear the connect timeout,
invalidate the token, tear the provider down, reconnect after N ms. Backoff,
retry budget and storm detection live there; timers, sockets and React do not,
so its interface is the test surface (plain vitest, no jsdom).
`useCollaborativeDoc` is the imperative shell, and the invariant that matters is
that there is exactly **one** of it: one `runEffects` that carries out all four
kinds, and one `publish` through which every state change passes. Both had two
copies. The browser-connectivity effect owned a second interpreter handling two
kinds — it could not set the `settled` flag that stops a torn-down provider
reporting its own death — and a `useReducer` re-ran the reducer on each event to
recompute a state the caller already had, discarding that run's effects. Events
from outside the connection effect reach the one interpreter through `reportRef`
rather than by growing a copy.
_Avoid_: reconnect logic, connection manager, retry handler, socket state

**Sync state**:
What a surface tells the user about its room, as one value out of a closed set —
`connected`, `connecting`, `offline`, `error` — derived by `syncState` from the
connection policy's output plus whether the sync layer is degraded. It is one
value rather than a set of booleans because `connecting` is not a verdict: a
caller that could only supply "connected" showed a hard offline icon while an
attempt was still in flight, which is what the task description did. `error`
outranks `connected`, since a live socket carrying nothing is the more
misleading of the two. Distinct from a [hydrated replica](#), which is about
whether there is anything to *show*, not about the socket.
_Avoid_: connection status, online state, connected flag

**Empty-document root**:
The canonical `blockGroup` a BlockNote document starts life with, shipped as
one fixed-client-id Yjs update (`collab/empty-document.ts`) so that every
client bootstraps *the same* root rather than one of its own. Makes "this
document is empty" a value that can be stored, cached and merged, instead of
an absence that each client fills in differently. `EMPTY_SPREADSHEET_UPDATE`
(`collab/empty-grid.ts`) is the same device for the spreadsheet grid.
Both carry the same precondition, and it is the whole point of them: seed only
a [hydrated replica](#). On one that has simply not been told anything, the
seed plants a structure beside the real one. `seedEmptyDocument` and
`seedEmptyGrid` are the only ways to apply either, so the precondition has one
place to be stated rather than being implied by whoever decided to mount an
editor. The grid's used to run from `SpreadsheetYjsBinding`'s constructor on a
row-count check, which is how guests — who hydrate only on a live sync — seeded
theirs every time.
_Avoid_: default content, initial block, placeholder doc

**Timeline geometry**:
The pure mapping between a task's ISO planned dates and the Gantt's pixel/column
grid — range padding/fill, drop-date snapping, paging, and the Day/Week/Month
**column resolution** (one visible column spans N day-units; Week renders 7-day
cells so SVAR's lowest scale unit stays the day and month banners land on true
calendar boundaries). Lives in `ganttTimeline.ts`; imports no React/SVAR/DOM, so
its interface is the test surface (plain vitest, no jsdom). `GanttView` is the
imperative shell that reads SVAR/DOM state and `today`, hands them in as plain
values, and executes the returned plans (e.g. a `PageScrollPlan`).
_Avoid_: gantt helpers, date math, svar utils, zoom level

**RealtimeKit client**:
The single adapter (`convex/lib/realtimeKit.ts`) through which Ripple talks to
Cloudflare RealtimeKit — create meeting, add participant, delete orphan meeting.
Constructed from env via `realtimeKitFromEnv()`, or from explicit credentials
(tests pass a fake). Every call surface — channel calls, event calls, guest
share links, the voice agent — goes through it rather than calling `fetch`.
_Avoid_: CF client, meeting API, RTK fetch helper

**Workspace graph**:
The node-link view on the workspace landing page, and the `getWorkspaceGraph`
query behind it (`convex/graph.ts`). Its nodes come from the `nodes` table, one
row per resource; its links come from `edges` plus **tag synthesis** — `tags` /
`entityTags` / `taskTags` are read at query time and emitted as virtual tag
nodes and `tagged_with` links, so tags never became a `resourceType`.
Distinct from the **local graph** (not yet built): the whole-workspace view is
unbounded in both directions — it reads five whole workspace-scoped tables, and
its read set is those five index ranges, so any write in the workspace re-runs
it for every subscribed client. Chat is no longer one of those writes (see
**mention counter**), and the query is only subscribed while its own tab is open
on desktop, but the read itself is still uncapped. Treat "add it to the graph"
as a question about which of those two surfaces you mean.
_Avoid_: knowledge graph, node graph, graph view, force graph

**Reference chip**:
The inline, name-only pointer a `#` pick inserts into a message or a document —
`resourceReference` in BlockNote, rendered by `ResourceReferenceChip`. It shows
the resource's name *as resolved at read time*, not the one stored on the node,
so a renamed resource reads correctly and a deleted one degrades to
`#inaccessible-<type>`. It is **not** a tag: a [tag](#) in Ripple is a workspace
label a resource carries, with its own tables and its own synthesis into the
[workspace graph](#). A chip is one message's reference to one resource.
_Avoid_: tag, mention pill, resource tag, inline link

**Snapshot embed**:
A frozen copy of another resource's content, carried inside the message or
document that embeds it and never updated again — a diagram as a PNG, a
spreadsheet range as a table of its cells. The opposite of a
[reference chip](#), which resolves at read time, and of the document range
block, which tracks its cells through a `spreadsheetCellRefs` row. Frozen is the
point: a message is a record of what someone said, and a table that silently
rewrote itself in the channel history would be a different product.
Its values are read from a [hydrated replica](#) of the source room at pick
time, never from the stored snapshot, so what the sender saw in the picker is
what the channel gets — a stored snapshot can lag the room by a save interval.
In chat a range embed is a chip *and* a table: the chip states the sheet and the
A1 range and remains the only thing that click-throughs, since the table carries
no coordinates of its own.
_Avoid_: frozen embed, copy, paste, static embed, inline table

**Mention edge**:
An `edges` row with `edgeType: "mentions"` and `sourceType: "channel"` — one per
(channel, target) pair, **not** one per message. The `messages` trigger
(`dbTriggers.ts`) writes it on the first mention and deletes it when the last
one goes; in between, every repeat mention only bumps the pair's
**mention counter**. The row is therefore a statement that the link exists, and
carries no multiplicity of its own.
_Avoid_: mention link, channel edge, backlink row

**Mention counter**:
A `channelMentionCounts` row: the multiplicity behind one **mention edge**, with
`count` (live messages mentioning that target in that channel), `lastAt` (newest
mention, so the link can later be weighted or windowed by recency), and `edgeId`
(the edge it keeps alive — which makes the decrement a point delete instead of a
scan of the pair's bucket, and makes `collapseChannelMentionEdges` safe to
re-run).
This table exists to keep chat volume out of `edges`. Channel mentions were the
only writer to `edges` whose row count grew with messages sent rather than with
resource count, and `edges.by_workspace` is the range the **workspace graph**
subscribes to — so a mention of an already-mentioned target used to re-ship the
whole graph to every client on the page. Nothing that reads the graph reads this
table; that is the point, so keep it that way.
_Avoid_: mention count table, edge weight, mention index

**Route adapter**:
The preamble every machine-to-machine HTTP route shares, as one module
(`convex/httpAdapter.ts`): `requireSharedSecret` (the `Bearer` gate),
`parseRoomId` (a room id split against a caller-supplied whitelist, returning a
tagged union), `json` (the response shaping), and `guarded` (throw → logged 500).
Imports nothing from Convex, so its interface is the test surface — the routes in
`http.ts` are the imperative shell that reads env and query params and runs the
one query the route exists for. Whitelists come from `COLLAB_RESOURCES` /
`COLLAB_ROOMS` / `YJS_SHARE_ROOMS`, never from a spelled-out union at the call
site: the seven hand-copied secret checks had already drifted into two shapes,
two of them missing the `Bearer` guard.
_Avoid_: http helpers, route utils, middleware

**Channel**:
A `channels` row with `kind: "channel"` — a named, workspace-scoped conversation
whose roster you manage and whose **visibility** you choose. The thing the
sidebar's "Channels" section lists and the browse page filters.
_Avoid_: room, group, chat, conversation

**Direct message**:
A `channels` row with `kind: "dm"` — a conversation between exactly two
workspace members, sharing every mechanism a **channel** has (messages, calls,
reads, mentions, `requireChannelAccess`) and none of its configuration: it has
no name of its own (its label *is* its roster), no join request, no settings
page, and no visibility to set. It is not "a private channel"; it is the other
**kind** of conversation.
_Avoid_: DM channel, private channel, 1-on-1, chat

**Kind**:
Which of the two things a `channels` row is — `"channel"` or `"dm"`. The axis
that says whether a row is *configurable*, and therefore the one every query
that means "browsable conversations" filters on. Distinct from **visibility**,
which only a **channel** has.
_Avoid_: type, channel type, category

**Visibility**:
Who in the workspace may enter a **channel**: **Public** (any member may read
and join) or **Private** (members are invited, or ask via a join request). A
property of the channel, identical for everyone who can see it — never a
per-user view state, which is **dismissal**. A **direct message** has no
visibility: it is not a third value on this axis, and any value stored on a DM
row is a derived constant, never a setting.
_Avoid_: privacy level, access level, channel type, open/closed, hidden

**Dismissal**:
One user's decision to drop a conversation out of their own sidebar, stored as
`userChannelState.hiddenAt`. The only way to decline a **public channel**, since
you are not a member of one and so have nothing to leave; and the whole lifecycle
of a **direct message**, which cannot be deleted or left and so ends by being
dismissed and restarts when a message arrives newer than `hiddenAt`. Private
channels are left, never dismissed. Per-user and cross-device — the opposite of
**visibility** on both counts, which is why it does not live in device storage.
_Avoid_: hiding, visibility, archiving, muting, closing

**Series**:
The resource behind a repeating meeting: one title, one roster, one venue, one
recurrence rule, and one local anchor (start date, wall-clock time, IANA
timezone) with a duration. It is the thing that has an id — the thing you open,
tag, `@`-mention, invite people to, and hold a graph node for. A one-off event
is not a series with one occurrence; the two are different rows and only one of
them has a rule.
_Avoid_: recurring event, repeating event, recurrent event, master, parent event

**Occurrence**:
One dated appearance of a [series](#), identified by the pair
(series, **original start**) — never by a row id, because in the general case
there is no row. The calendar computes occurrences from the rule at read time,
the way a [reference chip](#) resolves its name at read time rather than
storing it. "Next Tuesday's standup" is an occurrence; it is a projection of
the series, not a second resource.
_Avoid_: instance, event, repeat, expansion

**Original start**:
The instant the rule *would* place an [occurrence](#) at, which is that
occurrence's name for as long as it exists — it does not move when the
occurrence is rescheduled, and it survives the occurrence being cancelled. The
coordinate an [override](#) is filed under and the one a URL carries.
_Avoid_: start time, recurrence id, slot, original date

**Override**:
The single occurrence that has been edited away from its series — moved,
renamed, or otherwise changed — and so has become a row of its own, filed under
its [original start](#). Frozen where a plain [occurrence](#) is computed, which
is the [snapshot embed](#) / [reference chip](#) split again: it stops tracking
the series entirely, so renaming the series leaves the override showing its old
name. It is not a resource — no graph node, no tag rows, no `@`-mention entry —
because the resource is the series and an override is that series, on one date,
differing. A *cancelled* occurrence is not an override: it is an entry in the
series' excluded starts, which costs no row at all.
_Avoid_: exception, detached instance, modified occurrence, edited event

**Split**:
What "this and following" does to a [series](#): truncate the original so it
ends before the chosen [occurrence](#), and create a second series carrying the
change. The second series is a genuinely separate resource — its own id, node,
share links and mention target — which is why the choice is worth a name rather
than being described as an edit.
_Avoid_: fork, branch, detach, this-and-future

**Horizon**:
How far past the requested window a [series](#) is ever expanded (24 months),
and therefore the answer to what an unbounded series means at read time. A rule
with no end date is a statement about the rule; the horizon is the statement
that no read is unbounded because of it. Distinct from the series' own end,
which the organizer sets.
_Avoid_: lookahead, expansion limit, max date, window
