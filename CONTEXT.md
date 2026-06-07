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
