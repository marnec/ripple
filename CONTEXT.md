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
A page presenting one collaborative room to a member — a document, diagram or
spreadsheet — through one **opening sequence**: rule out deletion, refuse an
[unhydrated replica](#) nothing can reach, hold reserved space while the room is
still reachable, then hand the hydrated replica to the body. Controls that would
*change* the resource are offered only while the server is answering; the body
works from the local copy either way. The body is a child of the sequence rather
than a caller of it, so there is no way to bind an editing surface to a replica
whose contents are unknown. A task's description is not one: it has no header
and no settings route, so it opens its own room.
_Avoid_: editor page, doc view, resource page, resource shell

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
is the same device for the spreadsheet grid.
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
