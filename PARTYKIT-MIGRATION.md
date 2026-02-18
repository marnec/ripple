# Research: Upgrading from partykit to cloudflare/partykit (partyserver)

> Researched: 2026-02-18

## Context

Ripple uses `partykit@0.0.115` (the old managed platform). The old repo (`partykit/partykit`) is frozen -- last substantive release was May 2025, README now says *"Current development of this project is in cloudflare/partykit."* The new repo (`cloudflare/partykit`) is actively maintained (latest `partyserver@0.1.5`, Feb 9 2026). This document evaluates whether and when to migrate.

---

## Current Ripple PartyKit Usage

| Package | Version | Role |
|---------|---------|------|
| `partykit` | 0.0.115 | Server runtime + CLI (`npx partykit deploy`) |
| `partysocket` | 1.1.13 | WebSocket client (already at latest) |
| `y-partykit` | 0.0.33 | Yjs sync provider + server |

**Server code**: 2 parties in `partykit.json` -- main collab server (`partykit/server.ts`, 608 lines) + presence server (`partykit/presence-server.ts`, 184 lines). Uses `Party.Server` class-based API with `onStart`, `onConnect`, `onMessage`, `onClose`, `onAlarm`, `room.storage`, `room.broadcast`, `conn.setState`, alarm-based periodic saves, token auth via Convex HTTP endpoints.

**Client code**: `YPartyKitProvider` from `y-partykit/provider` (`src/hooks/use-yjs-provider.ts`), custom reconnection logic, awareness for cursor presence, `PartySocket` from `partysocket` for workspace presence (`src/hooks/use-workspace-presence.ts`).

**Critical patterns**: V2 Yjs encoding (avoiding y-partykit's `load` callback), workerd TCMalloc crash workaround, custom auth token flow via Convex (`convex/collaboration.ts` + `convex/http.ts`).

---

## What Changed: Old vs New

| Aspect | Old `partykit` | New `partyserver` |
|--------|---------------|-------------------|
| **npm package** | `partykit` (9.9 MB, frozen at 0.0.115) | `partyserver` (89.6 KB, actively updated) |
| **Yjs package** | `y-partykit` (frozen at 0.0.33) | `y-partyserver` (v1.0.0, Dec 2025) |
| **Client** | `partysocket` | `partysocket` (same name, continued) |
| **Server API** | `implements Party.Server` | `extends Server` (extends DurableObject) |
| **Deploy** | `npx partykit deploy` (managed platform) | `wrangler deploy` (your Cloudflare account) |
| **Config** | `partykit.json` | `wrangler.jsonc` (manual DO bindings) |
| **DO bindings** | Auto-inferred by platform | Manual in wrangler config |
| **URL routing** | Built into platform | `routePartykitRequest()` utility |
| **Hibernation** | Separate API | Unified (`static options = { hibernate: true }`) |
| **Static assets, AI** | Built-in bindings | Use wrangler's native support |

### y-partyserver vs y-partykit

The new `y-partyserver` has a cleaner persistence model:
- **`onLoad()`** -- called once when first client connects. You load state from external storage and apply it.
- **`onSave()`** -- called periodically after edits and when room empties. You encode and persist.
- **`callbackOptions`** -- configurable debounce for save timing.
- **Custom messages** -- `sendMessage()`/`onCustomMessage()`/`broadcastCustomMessage()` over the same Yjs WebSocket.
- **React hook** -- `useYProvider` from `y-partyserver/react`.

This is a better fit for Ripple's pattern than the current workaround (avoiding y-partykit's `load` callback and manually managing V2 encoding).

---

## Advantages of Upgrading

### 1. Active maintenance and bug fixes
The old repo is frozen. The new repo had 20+ commits in the first 9 days of Feb 2026 alone, fixing initialization race conditions, reconnection bugs, CORS support, and more. Any bugs you hit in the old version will never be fixed.

### 2. Better Yjs persistence model
`y-partyserver`'s `onLoad`/`onSave` hooks give you explicit control over encoding. No more workarounds to avoid the `load` callback's V1 encoding. Your V2 snapshot pattern would be naturally expressed:
```ts
class CollabServer extends YServer {
  async onLoad() { /* fetch V2 snapshot from Convex, applyUpdateV2 */ }
  async onSave() { /* encodeStateAsUpdateV2, save to Convex */ }
}
```

### 3. Potentially resolves workerd TCMalloc crash
`partyserver` uses `wrangler dev` instead of `partykit dev`. While both use workerd internally, the `partykit dev` wrapper has its own quirks. The crash may or may not persist, but you'd be on a more standard/maintained dev path.

### 4. Future-proofing
The managed PartyKit platform's future is uncertain. An open issue (#971) about 504 Gateway Timeout during `partykit deploy` (Oct 2025) suggests possible platform reliability issues. Moving to your own Cloudflare account removes this dependency.

### 5. New ecosystem packages
- **`partywhen`** -- Task scheduling on DO alarms (could replace manual alarm logic)
- **`partysub`** -- Pub/sub at scale with location hints
- **`hono-party`** -- Hono middleware integration
- Connection tags for filtering broadcasts
- CORS support built into `routePartykitRequest()`
- `usePartySocket`/`useWebSocket` `enabled` prop for conditional connections

### 6. Full Cloudflare Workers integration
Direct access to all Cloudflare bindings (KV, R2, D1, AI, etc.) through standard wrangler config instead of PartyKit's abstraction layer.

---

## Risks and Downsides

### 1. No migration guide exists
The file `docs/guides/migrating-from-partykit.md` in the new repo is **empty (0 bytes)**. Migration is DIY.

### 2. Pre-1.0 server library
`partyserver` is at 0.1.5 -- API may still shift. (Though `y-partyserver` is at 1.0.0.)

### 3. Significant refactoring required
- Server class: `implements Party.Server` -> `extends Server`
- All `Party.*` type imports change
- `partykit.json` -> `wrangler.jsonc` with manual DO bindings and migrations
- `y-partykit/provider` -> `y-partyserver/provider` (different constructor API)
- Deploy pipeline: `npx partykit deploy` -> `wrangler deploy`
- GitHub Actions workflow changes needed

### 4. Current setup works
Everything in production works fine. The V2 encoding workaround is stable, the auth flow is solid, the TCMalloc crash is dev-only with auto-restart. There's no urgent forcing function.

### 5. V2 encoding needs verification
Need to confirm `y-partyserver`'s `onLoad`/`onSave` don't interfere with V2 encoding. The hooks give raw bytes control, so this should be fine, but requires testing.

### 6. Deployment model changes
Moving from PartyKit's managed platform to your own Cloudflare account means you manage the wrangler config, DO migrations, and Cloudflare dashboard. More control but more responsibility.

---

## Recommendation

**Not urgent, but worth planning for.** The old platform won't get fixes or features, and the new ecosystem is clearly the future. However:

- Your current setup is stable and working in production
- The new library is pre-1.0 with no migration guide
- The migration is non-trivial (~2-3 day effort touching server, client, deploy pipeline)

**Suggested timing**: When you need a new PartyKit feature (connection tags, CORS, etc.), or when you encounter a production issue with the managed platform, or when `partyserver` reaches 1.0 with a migration guide.

---

## Migration Scope (When Ready)

1. Replace `partykit` + `y-partykit` with `partyserver` + `y-partyserver`
2. Rewrite `partykit/server.ts` to extend `Server` / `YServer` (lifecycle hooks map closely)
3. Rewrite `partykit/presence-server.ts` similarly
4. Convert `partykit.json` -> `wrangler.jsonc` with DO bindings
5. Update `src/hooks/use-yjs-provider.ts` to use `y-partyserver/provider` (or `useYProvider` hook)
6. Update deploy workflow (`.github/workflows/`) from `partykit deploy` -> `wrangler deploy`
7. Test V2 encoding roundtrip, auth token flow, presence, alarm-based saves

### Key File Mapping

| Current | After Migration |
|---------|----------------|
| `partykit.json` | `wrangler.jsonc` |
| `partykit/server.ts` (implements Party.Server) | `partykit/server.ts` (extends YServer) |
| `partykit/presence-server.ts` (implements Party.Server) | `partykit/presence-server.ts` (extends Server) |
| `y-partykit/provider` imports | `y-partyserver/provider` imports |
| `npx partykit deploy` | `wrangler deploy` |

### New Repo References

- Repo: https://github.com/cloudflare/partykit
- partyserver README: `packages/partyserver/README.md`
- y-partyserver README: `packages/y-partyserver/README.md`
- Migration guide (empty WIP): `docs/guides/migrating-from-partykit.md`
- Examples with Yjs: `fixtures/tiptap-yjs/`, `fixtures/lexical-yjs/`, `fixtures/monaco-yjs/`
- Blog post on API design: https://blog.partykit.io/posts/partyserver-api/
- Acquisition announcement: https://blog.partykit.io/posts/partykit-is-joining-cloudflare/
