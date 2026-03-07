# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (runs frontend + backend in parallel)
npm run dev

# Lint with TypeScript and ESLint (0 warnings allowed)
npm run lint

# Build for production
npm run build

# Deploy Convex backend only
npm run deploy:convex

# Deploy via git push to main
npm run deploy
```

## Architecture

Ripple is a real-time collaborative workspace built on Convex (serverless backend) with React/Vite frontend.

### Tech Stack
- **Frontend**: React 19, React Router v6, Tailwind CSS, shadcn/ui
- **Backend**: Convex (database, server functions, auth)
- **Real-time**: partyserver + y-partyserver (Yjs sync via Cloudflare Durable Objects), WebRTC (video calls)
- **Editor**: BlockNote with custom blocks (Excalidraw diagrams)

### Directory Structure
```
/src                    # React frontend
  /pages/App/          # Main app pages
    /Channel/          # Chat channels, video calls
    /Document/         # Collaborative documents (BlockNote)
    /Diagram/          # Excalidraw diagrams
    /Workspace/        # Workspace management
  /components/ui/      # shadcn/ui components (auto-generated, don't edit)
  /routes.tsx          # React Router configuration

/convex                # Backend functions
  /schema.ts           # Database schema with indexes
  /_generated/         # Auto-generated types (don't edit)

/shared                # Types/enums shared between frontend and backend
  /enums/roles.ts      # WorkspaceRole, ChannelRole, DocumentRole
```

### Data Model
- **Workspaces** contain channels, documents, and diagrams
- **Members** have roles (admin/member) at workspace, channel, and document levels
- **Channels** can be public or private within a workspace
- Messages have full-text search via `searchIndex`

### Permissions & Collaboration
- **Channels/Documents**: Access via per-resource membership tables (`channelMembers`, `documentMembers`)
- **Diagrams**: Access via **workspace membership** (all workspace members can access all diagrams)
- **Tasks/Projects**: Access via **workspace membership** (all workspace members can access all projects and tasks)
- Collaboration tokens (`convex/collaboration.ts`) must match the same access model as the resource's query functions — e.g. `diagrams.get` checks workspace membership, so `checkDiagramAccess` must too
- Real-time collaboration uses partyserver (Cloudflare Durable Objects + Yjs sync). Token flow: client calls `getCollaborationToken` action → receives one-time token → connects to partyserver with token → server verifies via Convex HTTP endpoint
- Server code lives in `partykit/` directory: `worker.ts` (entry point), `server.ts` (YServer for Yjs collab), `presence-server.ts` (Server for workspace presence)
- Dev config: `wrangler-partykit.jsonc` (DOs only, port 1999). Prod config: `wrangler.jsonc` (DOs + static assets)

### Path Aliases
- `@/*` → `./src/*`
- `@shared/*` → `./shared/*`

## PartyKit / Yjs Snapshot Encoding

- Uses `partyserver` + `y-partyserver` (migrated from legacy `partykit` package)
- Snapshots use V1 encoding: `Y.encodeStateAsUpdate` / `Y.applyUpdate`
- `y-partyserver`'s `onLoad`/`onSave` hooks handle persistence — snapshots stored in Convex blob storage
- Both read sites must stay in sync: `partykit/server.ts` (onLoad/onSave) and `use-snapshot-fallback.ts` (client cold-start)
- To wipe snapshot data: locally delete `.wrangler/` state; in prod clear `yjsSnapshotId` fields + delete linked `_storage` blobs from Convex

## Convex Guidelines

### Function Syntax
Always use the new function syntax with argument and return validators:
```typescript
import { query } from "./_generated/server";
import { v } from "convex/values";

export const myQuery = query({
  args: { id: v.id("users") },
  returns: v.string(),
  handler: async (ctx, args) => {
    // ...
  },
});
```

### Public vs Internal Functions
- `query`, `mutation`, `action` → Public API (exposed to clients)
- `internalQuery`, `internalMutation`, `internalAction` → Private (only callable from other Convex functions)

### Query Best Practices
- Use `withIndex()` instead of `filter()` for queries
- Define indexes in schema.ts with descriptive names (e.g., `by_workspace_user`)
- Use `.unique()` for single document queries
- Actions cannot access `ctx.db` directly; call mutations/queries instead

### Function References
- Public: `api.filename.functionName`
- Internal: `internal.filename.functionName`
- **Do NOT use `makeFunctionReference`** — use `internal.*` / `api.*` directly (static codegen makes this safe)

### Static Codegen (TS2589 fix)

This project uses static code generation (`convex.json` → `staticApi: true, staticDataModel: true`) to avoid TS2589 "Type instantiation is excessively deep and possibly infinite". The root cause: Convex's default `ApiFromModules` type applies `FilterApi` recursively, and the generated `api`/`internal` declarations apply a second `FilterApi` pass on top, creating nested recursion that exceeds TypeScript's depth budget with 30+ modules. Static codegen pre-computes concrete `FunctionReference` types, bypassing `FilterApi` entirely.

**Trade-offs:** types only update when `convex dev` is running; jump-to-definition doesn't work for `api.*`/`internal.*`; functions without a `returns` validator default to `any` on the client.

**Future:** [convex-js#129](https://github.com/get-convex/convex-js/pull/129) replaces the double `FilterApi` with a single-pass `ByVisibility` type, which should fix TS2589 in dynamic codegen too. Once that ships (likely in a future convex-js release beyond 1.31.7), we can try removing `staticApi`/`staticDataModel` from `convex.json` and see if dynamic codegen works without TS2589. If it does, removing static codegen restores jump-to-definition and return type inference.

**Return validators:** with static codegen, prefer concrete return validators over `v.any()` — `v.any()` produces literal `any` on the client, causing implicit-any errors in strict mode.

### TypeScript
- Use `Id<"tableName">` for document ID types
- Use `Doc<"tableName">` for document types
- Functions returning nothing should have `returns: v.null()`

## Testing

Tests are vital to this application. When making changes to business logic, update or add corresponding tests.

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

### Test Structure
- **Backend tests** (`tests/convex/`): Use `convex-test` to test Convex mutations/queries with real schema validation. Helpers in `tests/convex/helpers.ts` provide `createTestContext`, `setupAuthenticatedUser`, and `setupWorkspaceWithAdmin`.
- **Frontend unit tests** (`src/**/*.test.ts`): Pure utility function tests using `vitest` + `jsdom`.

### When to Write Tests
- Any new Convex mutation/query with non-trivial logic (auth checks, cascading deletes, status sync, etc.)
- Utility functions with business logic (formatters, parsers, computed values)
- Bug fixes should include a regression test when feasible

### UX principles
 - This app is opinionated on many topics, we don't want to please every possible user
 - Users should not be flooded with information, by default only essential information is visible
 - If the user desires more information it should be available and intuitively toggled / retrieved
 - **No skeleton loaders** — never use skeleton/pulse placeholders. Prefer empty reserved space (matching final dimensions) with a fade-in when content arrives. Loading spinners are acceptable only for full-page or full-section blocking loads.