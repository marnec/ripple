# Call Session Abstraction & PiP for Calendar Calls

**Status**: Draft plan
**Forcing function**: `README.md:4` — "pip for calendar calls too"
**Scope**: Frontend refactor only. Convex actions unchanged. Guest calls remain v1-untouched.

---

## 1. Why this is bigger than a feature ticket

The naive read of the TODO is "add a flag to `ActiveCallContext` so calendar calls can float too." Don't do that. The honest framing:

Three React surfaces independently re-implement the same call lifecycle. Today only one of them (channel) participates in PiP, because PiP was built into a context that's shaped around the channel concept. Each new call surface either re-implements PiP or skips it (the calendar surface explicitly skipped — see [EventVideoCall.tsx:24-34](../apps/web/src/pages/App/Calendar/EventVideoCall.tsx#L24-L34)).

The deepening opportunity: collapse the channel-bound `ActiveCallContext` plus the inline state machines in `EventVideoCall` and `GuestEventCall` into a single deeper module — a small interface (typed providers per kind) hiding a large, well-tested lifecycle (pure reducer + side-effecting hook).

PiP for calendar falls out of this refactor instead of being a special case grafted onto a fragile abstraction.

### Cluster

- [ActiveCallContext.tsx](../apps/web/src/contexts/ActiveCallContext.tsx) — channel-bound provider. Will be split.
- [GroupVideoCall.tsx](../apps/web/src/pages/App/GroupVideoCall/GroupVideoCall.tsx) — channel call surface.
- [EventVideoCall.tsx](../apps/web/src/pages/App/Calendar/EventVideoCall.tsx) — calendar event surface, reimplements lifecycle inline.
- [GuestEventCall.tsx](../apps/web/src/pages/Share/GuestEventCall.tsx) — third reimplementation. Out of scope for v1.
- [FloatingCallWindow.tsx](../apps/web/src/components/FloatingCallWindow.tsx) — global PiP, reads context.
- [App.tsx](../apps/web/src/pages/App/App.tsx) — mounts provider + floating window.
- [callSessions.ts](../apps/convex/convex/callSessions.ts) `joinCall`, [calendarEvents.ts](../apps/convex/convex/calendarEvents.ts) `joinEventCall` — backend, **unchanged**.

### Coupling category

Direct concept coupling: the channel concept is baked into a module that should be call-source-agnostic. Removing it requires a discriminated boundary between "lifecycle" (uniform) and "source" (per-kind).

### Constraints (must hold)

- Global `FloatingCallWindow` mount stays at app root and works for any active call kind.
- Convex actions unchanged — abstraction is purely client-side.
- Path-based `isFloating` works (it already would, since both routes end in `/videocall` — but the leave/return destinations differ per source).
- React Compiler ON: no `useCallback` / `useMemo`. No `forwardRef`. Use `use(Context)`.
- Strict TS. Static Convex codegen.
- No skeleton loaders (per CLAUDE.md UX principles) — stays out of scope here.

---

## 2. Designs evaluated

Four parallel proposals were generated; full text in conversation history. Summary:

| # | Shape | Strength | Weakness |
|---|---|---|---|
| D1 | `<CallProvider source={factory(...)}>` polymorphic source object | Min interface; trivial new-source path | Uniform consumer shape — no per-kind type safety |
| D2 | `<Call.Root><Call.Lobby/><Call.Stage/><Call.Floating/></Call.Root>` compound | Deduplicates UI as well as lifecycle | Doubles scope (UI rework); discoverability cost |
| D3 | `<ChannelCallProvider>` + `<EventCallProvider>`, twin typed providers | **Trivial call sites; full type safety per kind** | Lifecycle still embedded in React layer |
| D4 | Pure `CallSession` class + ports + adapters | **Highest testability**; pure core | Constructor-style is foreign to this codebase |

**Recommended: hybrid of D3 + D4, registry pattern from D1.**

- **D3 outer shape**: two typed providers, one line at each call site, no discriminant leaking into channel/event consumer code.
- **D4 inner shape**: lifecycle is a pure reducer (`callReducer`) plus a side-effecting hook (`useCallSession`) consuming a `CallSourcePort` interface. The reducer is unit-testable without React, RTK, or Convex.
- **D1 registry**: a `useSyncExternalStore`-backed single-slot store that providers write into when joined. `FloatingCallWindow` reads from the registry, not from any specific provider — so the global PiP mount is decoupled from where the typed provider lives in the tree.
- **Skip D2 for now**: UI deduplication is a real follow-up, but mixing it into this refactor doubles risk. The hybrid leaves the door open: compound UI primitives can sit *on top of* `useCallSession` later.

---

## 3. Target architecture

### File layout

```
apps/web/src/lib/call/
  reducer.ts                  # pure callReducer(state, event)
  use-call-session.ts         # useCallSession(config) — runs reducer + side effects
  source-port.ts              # CallSourcePort interface, CallSourceDescriptor, CallStatus types
  active-call-registry.ts     # useSyncExternalStore single-slot store + useActiveCall()
  use-floating.ts             # path-based isFloating + returnTo helpers

apps/web/src/contexts/
  ChannelCallContext.tsx      # ChannelCallProvider + useChannelCall (typed)
  EventCallContext.tsx        # EventCallProvider + useEventCall (typed)
  # ActiveCallContext.tsx     # DELETED at end of phase 3

apps/web/src/components/
  FloatingCallWindow.tsx      # consumes useActiveCall() from registry only
```

### The pure reducer

```ts
// apps/web/src/lib/call/reducer.ts
export type CallStatus = "idle" | "lobby" | "joining" | "joined" | "leaving" | "error";

export type CallState = {
  status: CallStatus;
  meetingId: string | null;
  authToken: string | null;
  prefs: { mic: boolean; cam: boolean };
  error: { reason: CallErrorReason } | null;
};

export type CallErrorReason =
  | "token-failed" | "rtk-init-failed" | "rtk-join-failed"
  | "kicked" | "network-lost" | "unknown";

export type CallEvent =
  | { type: "ENTER_LOBBY" }
  | { type: "JOIN_REQUESTED" }
  | { type: "TOKEN_OK"; authToken: string; meetingId: string }
  | { type: "TOKEN_FAILED"; reason: CallErrorReason }
  | { type: "RTK_JOINED" }
  | { type: "RTK_FAILED"; reason: CallErrorReason }
  | { type: "LEAVE_REQUESTED" }
  | { type: "RTK_LEFT" }
  | { type: "TERMINATED"; reason: CallErrorReason }
  | { type: "SET_PREFS"; patch: Partial<CallState["prefs"]> }
  | { type: "RESET" };

export function callReducer(state: CallState, event: CallEvent): CallState;
```

No React, no Convex, no RTK. Pure function. Tests run in milliseconds.

### The source port

```ts
// apps/web/src/lib/call/source-port.ts
export type CallSourceDescriptor = {
  kind: "channel" | "event" | "guest-event";
  id: string;                    // resourceId — channelId or eventId
  label: string;                 // PiP header — "#general" or event title
  homePath: string;              // call's owning route, used by isFloating
  leaveDestination: string;      // navigate target on leaveCall
};

export type CallSourcePort = {
  descriptor: CallSourceDescriptor;
  acquireToken(prefs: { mic: boolean; cam: boolean }): Promise<{
    authToken: string;
    meetingId: string;
  }>;
  /** Pre-flight gate; only EventCallProvider populates this (start-time check). */
  canJoin?(): { ok: true } | { ok: false; reason: string };
  /** Optional source-side cleanup invoked after RTK leaves cleanly. */
  onLeave?(): Promise<void> | void;
};
```

The port is the *only* seam between the lifecycle and the backend. Each typed provider builds one internally.

### useCallSession

```ts
// apps/web/src/lib/call/use-call-session.ts
export type UseCallSessionResult = {
  state: CallState;
  enterLobby: () => void;
  joinCall: () => Promise<void>;
  leaveCall: () => Promise<void>;
  setPrefs: (patch: Partial<CallState["prefs"]>) => void;
  rtkClient: RealtimeKitClient | null;
};

export function useCallSession(port: CallSourcePort): UseCallSessionResult;
```

Internally:
- `useReducer(callReducer, initialState)`
- A `useRealtimeKitClient` companion that mounts when `state.authToken` is set, joins on `JOIN_REQUESTED → TOKEN_OK`, dispatches `RTK_JOINED` / `RTK_FAILED` / `TERMINATED`.
- An effect that calls `port.acquireToken` on `JOIN_REQUESTED` and dispatches `TOKEN_OK` / `TOKEN_FAILED`.
- An effect that registers/deregisters with the active-call registry on `joined` / not-`joined`.
- A `beforeunload` listener that fires `LEAVE_REQUESTED` if `joined`.

### Typed providers

```ts
// apps/web/src/contexts/ChannelCallContext.tsx
type ChannelCallProviderProps = {
  channelId: Id<"channels">;
  workspaceId: Id<"workspaces">;
  channelName: string;
  children: ReactNode;
};

export function ChannelCallProvider(props: ChannelCallProviderProps): JSX.Element;

type ChannelCallView = UseCallSessionResult & {
  channelId: Id<"channels">;
  workspaceId: Id<"workspaces">;
  isFloating: boolean;
  returnToCall: () => void;
};

export function useChannelCall(): ChannelCallView; // throws if not mounted
```

`EventCallContext.tsx` is structurally identical, swapping ids and the Convex action. Each provider:

1. Resolves its Convex action via `useAction(api.X.Y)`.
2. Builds a `CallSourcePort` value (plain object, not memoized — the reducer only looks at `port.descriptor.id` for identity; React Compiler handles the rest).
3. Calls `useCallSession(port)`.
4. Computes `isFloating` and `returnToCall` from the port's `homePath`.
5. Provides a typed context with the merged shape.

The ~30 LOC duplication between the two providers is intentional — it's the part that legitimately differs per kind. Consolidating it would reintroduce the discriminant at call sites.

### Active-call registry

```ts
// apps/web/src/lib/call/active-call-registry.ts
export type ActiveCallView = {
  status: CallStatus;
  descriptor: CallSourceDescriptor;
  rtkClient: RealtimeKitClient | null;
  leaveCall: () => Promise<void>;
  returnToCall: () => void;
  isFloating: boolean;
};

export function useActiveCall(): ActiveCallView | null;

// Used by typed providers. Single-slot. Second registration warns + no-ops in dev.
export function registerActiveCall(view: ActiveCallView): () => void;
```

Backed by `useSyncExternalStore`. Single-slot invariant matches today's behavior (one call at a time per tab) and makes the constraint explicit. `FloatingCallWindow` consumes only this — never imports `useChannelCall` or `useEventCall`.

```tsx
// FloatingCallWindow.tsx (new shape)
function FloatingCallWindow() {
  const active = useActiveCall();
  if (!active || !active.isFloating || active.status !== "joined") return null;

  return (
    <PipShell
      label={active.descriptor.label}
      onReturn={active.returnToCall}
      onLeave={active.leaveCall}
      client={active.rtkClient!}
    />
  );
}
```

Switching on `active.descriptor.kind` happens at most for cosmetic differences (e.g. label prefix). All lifecycle is uniform.

### Call sites

```tsx
// Channel route
<ChannelCallProvider channelId={c._id} workspaceId={c.workspaceId} channelName={c.name}>
  <GroupVideoCall />
</ChannelCallProvider>

// Calendar event route
<EventCallProvider eventId={e._id} eventTitle={e.title} startsAt={e.startsAt}>
  <EventVideoCall />
</EventCallProvider>
```

One line each. No factories at the call site, no `source` prop, no discriminants.

---

## 4. Phased implementation (tracer bullets)

Each phase is a self-contained vertical slice that ships and is reviewable on its own. The repo stays green at every phase boundary.

### Phase 1 — Pure reducer + tests, no integration

**Goal**: extract `callReducer` and `CallState`/`CallEvent` types. Repo behavior unchanged.

**Touch**:
- `apps/web/src/lib/call/reducer.ts` (new)
- `apps/web/src/lib/call/__tests__/reducer.test.ts` (new) — see test plan below
- Nothing in `contexts/` or any page yet.

**Done when**: `npm test` passes with new reducer tests covering happy path + error transitions + invalid-event no-ops.

**Reviewability**: small isolated module, no UI churn, easy to verify.

### Phase 2 — `useCallSession` hook, behind a feature flag in ActiveCallContext

**Goal**: move the lifecycle from `ActiveCallContext` into `useCallSession`. The context becomes a thin wrapper that constructs a channel-shaped port and calls the hook. Behavior identical.

**Touch**:
- `apps/web/src/lib/call/use-call-session.ts` (new)
- `apps/web/src/lib/call/source-port.ts` (new)
- `apps/web/src/lib/call/use-floating.ts` (new) — extracts the path-based `isFloating` helper
- `apps/web/src/contexts/ActiveCallContext.tsx` — internals replaced by `useCallSession(channelPort)`. **Public API of `useActiveCall()` unchanged.**

**Done when**: `npm run lint && npm test && npm run build` all pass. Manual smoke: start a channel call, navigate away (PiP appears), return, leave. Same as today.

**Reviewability**: behavior-preserving refactor; diff is mechanical.

### Phase 3 — Active-call registry; FloatingCallWindow reads registry

**Goal**: introduce the registry. `ActiveCallContext` writes to it on `joined`. `FloatingCallWindow` reads `useActiveCall()` from registry instead of `useActiveCall()` from the context.

**Touch**:
- `apps/web/src/lib/call/active-call-registry.ts` (new)
- `apps/web/src/contexts/ActiveCallContext.tsx` — register/deregister via the registry effect
- `apps/web/src/components/FloatingCallWindow.tsx` — consumes registry hook

**Done when**: PiP for channel calls still works identically. The context's `useActiveCall` and the registry's `useActiveCall` coexist briefly; rename one to disambiguate (`useChannelCall` for the context-bound one is the eventual name; rename early to avoid confusion in this phase).

**Reviewability**: registry is a small isolated module; FloatingCallWindow change is small.

### Phase 4 — Rename `ActiveCallContext` → `ChannelCallProvider`/`useChannelCall`

**Goal**: pure renames + prop reshape. The provider now takes `channelId`/`workspaceId`/`channelName` as props instead of being a global root.

**Touch**:
- `apps/web/src/contexts/ChannelCallContext.tsx` (new, content moved from `ActiveCallContext.tsx`)
- `apps/web/src/contexts/ActiveCallContext.tsx` (delete)
- `apps/web/src/pages/App/App.tsx` — remove the global `<ActiveCallProvider>`; mount `<FloatingCallWindow>` directly (it reads the registry, doesn't need a wrapping provider)
- Channel route — wraps its subtree in `<ChannelCallProvider>` with the resolved channel doc
- `apps/web/src/pages/App/GroupVideoCall/GroupVideoCall.tsx` — calls `useChannelCall()`

**Done when**: channel calls work end-to-end with the new provider mounted at the channel route. PiP still works (registry independent of mount location).

**Reviewability**: largest diff in the plan, but mechanical rename + one move.

### Phase 5 — Add `EventCallProvider`; refactor `EventVideoCall`; PiP for calendar calls works

**Goal**: the actual feature.

**Touch**:
- `apps/web/src/contexts/EventCallContext.tsx` (new) — twin of `ChannelCallContext`, swaps action and `canJoin`
- `apps/web/src/pages/App/Calendar/EventVideoCall.tsx` — drops local `useState`/`useRealtimeKitClient`; consumes `useEventCall()`. The "PiP intentionally skipped" comment block (lines 24-34) deletes.
- Calendar event route wraps in `<EventCallProvider>`.
- `FloatingCallWindow` confirmed to render `descriptor.label` correctly for events (no `if eventId` branches in the consumer code).

**Done when**: starting a calendar call, navigating to `/dashboard/calendar`, the PiP appears with the event title; clicking "return" navigates back to `/calendar/events/:id/videocall`; clicking "leave" cleanly disconnects and navigates to `/dashboard/calendar`. Channel calls still work.

**Reviewability**: this is where the visible behavior change ships. Smoke test covers both surfaces side-by-side.

### Out of scope (v1)

- Guest call (`GuestEventCall.tsx`) adoption. Pattern: build a `useGuestEventCallSource` factory; the page can mount a `GuestEventCallProvider` later. The registry-based PiP would need a parallel `<FloatingCallWindow>` mount on the guest layout. No work in v1; the abstraction is ready when we want it.
- Compound UI primitives (`<Call.Lobby>` etc.). Separate refactor on top of `useCallSession`. Not blocked by this plan.
- A second simultaneous active call. Single-slot registry, dev warning.

---

## 5. Test plan

All tests live in `apps/web/src/lib/call/__tests__/`. Vitest, no jsdom needed for the reducer.

### `reducer.test.ts` (Phase 1)

1. **Happy path**: `idle → ENTER_LOBBY → lobby → JOIN_REQUESTED → joining → TOKEN_OK → joining (with token+meetingId set) → RTK_JOINED → joined`. Assert all field transitions.
2. **Token failure**: `JOIN_REQUESTED → TOKEN_FAILED('token-failed') → error` with reason set; `RESET → idle`.
3. **RTK init failure**: from `joining` with token set, `RTK_FAILED('rtk-init-failed') → error`. The hook's RTK side effect is responsible for cleanup; reducer doesn't call leave.
4. **Leave from joined**: `LEAVE_REQUESTED → leaving → RTK_LEFT → idle`. `meetingId`/`authToken` cleared.
5. **Termination during joined**: `TERMINATED('kicked') → error`. No `leaving` transition (already terminated by RTK side).
6. **Invalid events are no-ops**: `RTK_JOINED` while `idle` → no change. `JOIN_REQUESTED` while `joined` → no change.
7. **Prefs survive transitions**: `SET_PREFS({mic:false}) → JOIN_REQUESTED → TOKEN_OK` keeps `prefs.mic === false`.
8. **RESET from any error returns to idle with prefs preserved**.

### `active-call-registry.test.ts` (Phase 3)

1. Empty store: `useActiveCall()` returns `null`.
2. Single registration: assert subscribers see the view; unregister returns to `null`.
3. Double registration: dev warning logged, second registration rejected, first still active. (Skip in production builds.)

### Manual smoke (Phase 4 + 5)

| Scenario | Expected |
|---|---|
| Start channel call, navigate to `/projects` | PiP shows channel name, return navigates back |
| Channel call leave from PiP | Navigates to channel page; RTK disconnected |
| Start event call, navigate to `/dashboard/calendar` | PiP shows event title, return navigates back |
| Event call leave from PiP | Navigates to `/dashboard/calendar`; RTK disconnected |
| Start channel call, then attempt to start event call mid-call | Dev warning; second join no-ops (single-slot invariant) |
| Refresh during joined | `beforeunload` fires `LEAVE_REQUESTED`, RTK disconnects cleanly |

---

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Hidden coupling in `ActiveCallContext` discovered mid-refactor | Phases 1-3 preserve the public API; if anything breaks, only those internal changes need rollback. |
| RTK lifecycle has edge cases the reducer doesn't capture | The hook layer keeps imperative RTK calls; reducer transitions are *driven by* RTK callbacks, not the source of truth for RTK. Bugs are localized. |
| Path-based `isFloating` regresses for events | `homePath` is set per-source; `useFloating(homePath)` is a single helper used by both providers — one bug surface, one test. |
| Static Convex codegen + `v.any()` returns | Both join actions already have concrete return validators (`{ authToken, meetingId }`). Confirmed by inspection. |
| React Compiler reacts poorly to fresh port objects each render | Reducer + registry only depend on `descriptor.id`; port methods are called from effects keyed on `id`. No identity-based memo needed. |
| GuestEventCall adoption needed sooner than v1 | Pattern is documented; ~50 LOC to add a third provider. Not blocked. |

---

## 7. Composition rules applied

Per [`.claude/skills/vercel-composition-patterns`](../.claude/skills/vercel-composition-patterns/AGENTS.md):

- **`architecture-avoid-boolean-props`**: no `<CallProvider mode="event">`. Two explicitly named providers; consumers see typed APIs.
- **`architecture-compound-components`**: not applied here (intentional, deferred to a follow-up). The hybrid leaves room for `<Call.*>` primitives over `useCallSession`.
- **`state-decouple-implementation`**: typed providers are the only place that knows `api.callSessions.joinCall` vs `api.calendarEvents.joinEventCall`. Consumers are oblivious.
- **`state-context-interface`**: the registry's `ActiveCallView` is a generic interface; `descriptor` carries the discriminant for the *one* polymorphic consumer (PiP). All other consumers read typed contexts.
- **`state-lift-state`**: lifecycle state is in the typed providers, accessible to all descendants without prop drilling.
- **`patterns-explicit-variants`**: `ChannelCallProvider` vs `EventCallProvider`. Each has different *required* props (`startsAt` only on event), and the type system enforces this.
- **`patterns-children-over-render-props`**: providers take `children`; no `render` props anywhere.
- **`react19-no-forwardref`**: nothing in this plan uses `forwardRef`. Context reads use `use(Ctx)`.

---

## 8. What this unlocks

- PiP for calendar calls (the literal goal).
- Guest calls can adopt PiP on the public layout by mounting `GuestEventCallProvider` + a layout-scoped `FloatingCallWindow`.
- New call surfaces (DMs, scheduled team meetings) plug in by writing one provider file.
- The lifecycle is finally tested. Today none of it is — three reimplementations all rely on manual smoke testing.
- Compound UI primitives become a tractable follow-up: the lifecycle is already extracted; only the lobby/stage/controls UI need deduping.

---

## 9. Definition of done

- [ ] `npm run lint && npm test && npm run build` green
- [ ] Channel call flow unchanged (regression smoke)
- [ ] Calendar event call PiP works end-to-end (return + leave)
- [ ] `EventVideoCall.tsx` PiP-skip comment removed
- [ ] `ActiveCallContext.tsx` deleted
- [ ] Reducer test suite covers 8 scenarios in §5
- [ ] No `useCallback`/`useMemo` introduced; no `forwardRef`
- [ ] `FloatingCallWindow` imports neither `useChannelCall` nor `useEventCall`
