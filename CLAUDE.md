# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development — every dev server (see "Dev startup order")
npm run dev

# Admin console + Convex only
npm run dev:admin

# Lint with TypeScript and ESLint (0 warnings allowed)
npm run lint

# Build for production
npm run build

# Deploy Convex backend only
npm run deploy:convex

# Deploy via git push to main
npm run deploy
```

### Dev startup order

**`convex dev` is the outer process, turbo is nested inside it.** `npm run dev`
is `convex dev --start 'pnpm -w run dev:fleet'`:

1. `convex dev` pushes functions and writes `convex/_generated/`. Nothing else
   starts until that first push lands.
2. `--start` then spawns `dev:fleet` — `turbo run dev --filter=!@ripple/convex`:
   `vite` for web (`:5173`, `--open`) and admin (`:5273`), and `wrangler dev` for
   the collaboration server (`:1999`) and the RSVP email worker (`:1998`).
3. The same `convex dev` stays in the foreground watching for backend changes.

The gate exists because Vite boots in ~200ms: without it the browser opened onto
a deployment that was still mid-push, so the first load hit missing functions and
a dead `localhost:1999` and had to be reloaded.

**Why not a turbo `dev:setup` task.** That was the previous shape — a
`convex dev --once` gate that every other `dev` task depended on. It pushed
*twice* every startup: `watchAndPush` in the Convex CLI runs an unconditional
`runPush` when the watcher boots, with no "already up to date" short-circuit, so
the persistent `convex dev` immediately re-pushed everything the gate had just
pushed (~15s of pure waste, typecheck included). There is no flag to suppress it.
`--start` is the CLI's own answer: one watcher, one push, ordering preserved.

The cost of the swap: the `--start` command is spawned inside the success branch
of `runPush`, so a schema or TS error now blocks the frontend from coming up
instead of letting it start against the last-good deployment. When you need the
frontend while the backend is broken, run `dev:frontend` / `dev:partykit` /
`dev:rsvp-worker` directly.

`dev` runs the whole fleet. `dev:admin` is the one subset worth having — same
`convex dev --start` wrapper around `dev:admin:fleet`. Only `@ripple/web` opens a
browser tab; the admin console is one you open when you need it, not a second tab
on every start.

The `dev:fleet` / `dev:admin:fleet` indirection is not cosmetic: `--start` runs
its command with cwd `apps/convex`, and turbo auto-scopes to the package it is
invoked from — `turbo run dev` there would resolve to `@ripple/convex#dev` and
start a *second* watcher. `pnpm -w run` bounces back to the workspace root first.

Ports are `--strictPort` on purpose: the dev deployment's `SITE_URL` is
`https://localhost:5173`, so silently sliding to `:5174` would break invite and
auth links. The flip side is that another project holding `:5173` fails the whole
`turbo run` — free the port rather than dropping the flag.

## Architecture

Ripple is a real-time collaborative workspace built on Convex (serverless backend) with React/Vite frontend.

### Tech Stack
- **Frontend**: React 19, React Router v6, Tailwind CSS, shadcn/ui
- **Backend**: Convex (database, server functions, auth)
- **Real-time**: partyserver + y-partyserver (Yjs sync via Cloudflare Durable Objects), WebRTC (video calls)
- **Editor**: BlockNote with custom blocks (Excalidraw diagrams)
- **Compiler**: React Compiler (`babel-plugin-react-compiler`) is active — **do not use `useCallback` or `useMemo`** for performance optimization. The compiler handles memoization automatically. Only use these hooks if there is a semantic reason beyond caching (which is essentially never with React Compiler).

### Directory Structure

pnpm workspaces + turbo. Every package is consumed as raw TypeScript source —
none of them have a build step.

```
/apps
  /web                 # The product (React + Vite)
    /src/pages/App/    # Main app pages
      /Channel/        # Chat channels, video calls
      /Document/       # Collaborative documents (BlockNote)
      /Diagram/        # Excalidraw diagrams
      /Workspace/      # Workspace management
    /src/components/ui/  # App-specific compositions only (see below)
    /src/index.css     # This app's design tokens
    /src/routes.tsx    # React Router configuration
  /admin               # Platform-admin console, same Convex deployment
    /src/index.css     # This app's design tokens (dark-only console theme)
  /convex              # Backend functions
    /convex/schema.ts  # Database schema with indexes
    /convex/_generated/  # Auto-generated types (don't edit)

/packages
  /ui                  # shadcn primitives shared by web + admin — see its README
  /shared              # Types/enums shared between frontend and backend
    /src/enums/roles.ts  # WorkspaceRole, ChannelRole, ChannelType
  /partykit            # Collaboration server (Cloudflare Durable Objects)
```

### Shared UI vs app-local UI

- `@ripple/ui` owns **component shape**; each app's `index.css` owns **token
  values**. Never put a colour in the package — that separation is what lets
  admin be a dark amber console and web a light/dark product off one set of
  primitives.
- Both apps' `components.json` point `ui` at `@ripple/ui/components`, so
  `shadcn add <x>` from either app installs into the package.
- App-specific compositions (`responsive-dialog`, `sidebar`, `safe-html`, admin's
  `console`) stay in that app's `src/components/ui/`.
- Both apps must keep `@source "../../../packages/ui/src"` in `index.css` —
  Tailwind v4 does not scan `node_modules`, so without it the package's utility
  classes are never generated.
- Deviations from stock shadcn output carry an inline `LOCAL PATCH` comment, so
  the next `shadcn add` doesn't silently drop them.

### Data Model
- **Workspaces** contain channels, documents, diagrams, spreadsheets, projects and tasks
- **Members** have roles (admin/member) at the **workspace** and **channel** levels only — there is no per-document role
- **Channels** are one of three types (`ChannelType`): `open`, `closed`, or `dm`
- Messages have full-text search via `searchIndex`

### Permissions & Collaboration
There are exactly **two** access rules. Every gate is one of them — if you are writing a third, you are writing a bug.

- **Channels and their messages**: the **channel** rule, via `requireChannelAccess` (`authHelpers.ts`). Open channels are readable by any workspace member; **closed** and **dm** channels require a `channelMembers` row. Workspace membership alone is NOT sufficient — gating chat on `requireWorkspaceMember` lets any colleague read and post in a private channel or someone else's DM. There is no `documentMembers` table; per-resource membership exists only for channels.
- **Documents, diagrams, spreadsheets, tasks, projects, cycles**: the **workspace** rule, via `requireResourceMember` / `checkResourceMember` (all workspace members reach all of them).
- **Every path to the same bytes must use the same rule.** A resource's Yjs state is reachable three ways — the query (`documents.get`), the collaboration token (`collaboration.checkAccess`), and the signed snapshot blob (`snapshots.getSnapshotUrl`). The latter two share `hasResourceAccess`; `getSnapshotUrl` hands out a storage URL for the *full* document, so authenticating without authorizing it is a cross-workspace read. Adding a new resource type means adding it to `hasResourceAccess`, not just to the query.
- Regression tests for both rules: `tests/messages.access.test.ts`, `tests/snapshots.access.test.ts`.
- Real-time collaboration uses partyserver (Cloudflare Durable Objects + Yjs sync). Token flow: client calls `getCollaborationToken` action → receives one-time token → connects to partyserver with token → server verifies via Convex HTTP endpoint
- Server code lives in `packages/partykit/src/`: `worker.ts` (entry point), `server.ts` (YServer for Yjs collab), `presence-server.ts` (Server for workspace presence)
- Two wrangler configs wrap that one entry point. Dev: `packages/partykit/wrangler.jsonc` (worker `ripple-dev`, DOs only, no assets) — the `:1999` comes from its `dev` script, not the config. Prod: `apps/web/wrangler.jsonc` (worker `ripple`), whose `main` points back at `packages/partykit/src/worker.ts` and adds the web SPA's `dist/` as the `ASSETS` binding. So prod ships collaboration server and frontend as a single Worker; editing `worker.ts` changes both.

### GitHub Integration — PR ↔ task linking
- A PR links to a task via three signals, resolved in `resolveTaskIds` (`convex/integrations/core/syncInPullRequests.ts`): GitHub's native closing graph (node ids, **default-branch only**), `Closes/Fixes/Resolves #N` keywords parsed from the PR title/body (any branch), and the leading issue number of a conventional source branch (`<issueNumber>-…`, any branch). Keep all three — keyword parsing is NOT redundant with branch-name linking (it's the only signal for an arbitrarily-named branch on a non-default base).
- **Union, by design**: when signals reference *different* issues (e.g. branch `42-foo` but body `Closes #99`), the PR links to **both** tasks and both advance on merge — there is no precedence between signals. This matches GitHub's own multi-issue-close semantics. Scoped to same-repo/same-project, and status moves are forward-only, which bounds the blast radius of a stray reference. Do not add precedence/dedup-to-one — it would break legitimate multi-issue PRs.

### Path Aliases
- `@/*` → that app's `./src/*`
- `@shared/*` → `packages/shared/src/*`
- `@convex/*` → `apps/convex/convex/*`
- `@ripple/ui/components/*`, `@ripple/ui/lib/utils` — the shared primitives
  package, imported by package name rather than an alias. Each app's
  `@/lib/utils` re-exports `cn` from it so there is one instance.

## PartyKit / Yjs Snapshot Encoding

- Uses `partyserver` + `y-partyserver` (migrated from legacy `partykit` package)
- Snapshots use V1 encoding: `Y.encodeStateAsUpdate` / `Y.applyUpdate`
- `y-partyserver`'s `onLoad`/`onSave` hooks handle persistence — snapshots stored in Convex blob storage
- Both read sites must stay in sync: `partykit/server.ts` (onLoad/onSave) and `use-snapshot-fallback.ts` (client cold-start)
- The PartyKit-facing routes in `http.ts` go through the **route adapter** (`convex/httpAdapter.ts`) — `guarded` + `requireSharedSecret` + `parseRoomId` + `json`. A new route composes those; it does not re-derive the secret check or the roomId split (see CONTEXT.md)
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

### Writes: one way in

`mutation` and `internalMutation` come from **`convex/functions.ts`**, never from
`./_generated/server`. They are `customMutation(raw, customCtx(triggers.wrapDB))`,
so the handler's `ctx.db` already fires the ~31 triggers in `dbTriggers.ts` — the
workspace aggregates, the `nodes` index, the `taskTags` join columns the
tag-filtered board queries partition on, the tag uniqueness invariants, the
notification-subscription view. `query`, `action` and the `*Ctx` types still come
from `_generated/server`.

- Just write `ctx.db.patch(...)`. There is nothing to remember and no wrapper to
  apply — that is the point. This replaced a convention re-derived at 58 call
  sites, which three sites had silently forgotten (a kanban drag left
  `taskTags.completed` stale, so the task vanished from a tag-filtered board).
- **Never re-wrap.** `writerWithTriggers(ctx, ctx.db, triggers)` or
  `withTriggers(ctx)` inside a handler does not just double-fire the triggers:
  both layers take convex-helpers' module-level `outerWriteLock`, so the inner
  write waits on a lock the outer write holds and the mutation **deadlocks**.
- Two deliberate exceptions, both pinned by allowlists in
  `tests/triggerWriteGuard.test.ts` (which enforces all of the above — `apps/convex`'s
  lint step is `tsc` only): `auth.ts`'s Convex Auth callbacks aren't our mutations
  so they apply `withTriggers` by hand, and `migrations.ts` stays on the raw
  builder because it is the *repair* path for trigger-maintained state
  (`backfill*Aggregates` calls `insertIfDoesNotExist` itself).
- Aggregates register `idempotentTrigger()`, not `trigger()`, so a row that was
  never counted (data predating an aggregate, a raw-seeded test fixture) self-heals
  on its first write instead of throwing `DELETE_MISSING_KEY`.

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

## Convex

This project uses [Convex](https://convex.dev) as its backend.

The Convex project root is `apps/convex/` (that is where `convex.json` lives) —
always run `npx convex …` from there, never from the repo root.

When working on Convex code, **always read
`apps/convex/convex/_generated/ai/guidelines.md` first** for important
guidelines on how to correctly use Convex APIs and patterns. The file contains
rules that override what you may have learned about Convex from training data.

Convex agent skills live at the repo root in `.claude/skills/convex-*`. They are
refreshed with `npx skills add get-convex/agent-skills --copy` run from the repo
root — `apps/convex/convex.json` sets `aiFiles.skills.agents: []` so the Convex
CLI does not install a second copy under `apps/convex/`.
