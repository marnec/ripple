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
- **Frontend**: React 18, React Router v6, Tailwind CSS, shadcn/ui
- **Backend**: Convex (database, server functions, auth)
- **Real-time**: Convex Presence (user presence), ProseMirror Sync (collaborative docs), WebRTC (video calls)
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
- **Tasks**: Access via **project membership** (`projectMembers`)
- Collaboration tokens (`convex/collaboration.ts`) must match the same access model as the resource's query functions — e.g. `diagrams.get` checks workspace membership, so `checkDiagramAccess` must too
- Real-time collaboration uses PartyKit (Yjs sync). Token flow: client calls `getCollaborationToken` action → receives one-time token → connects to PartyKit with token → PartyKit server verifies via Convex HTTP endpoint

### Path Aliases
- `@/*` → `./src/*`
- `@shared/*` → `./shared/*`

## PartyKit / Yjs Snapshot Encoding

- Snapshots are saved with `Y.encodeStateAsUpdateV2` and loaded with `Y.applyUpdateV2`
- **Do not use y-partykit's `load` callback** — it internally V1-encodes the returned Y.Doc (`encodeStateAsUpdate` + `applyUpdate`), bypassing our V2 encoding. Instead, create the doc empty and apply V2 bytes directly via `Y.applyUpdateV2`
- All three read sites must stay in sync: `partykit/server.ts` (load), `DiagramPage.tsx` (cold-start), `DocumentEditor.tsx` (cold-start)
- To wipe snapshot data: locally `rm -rf .partykit/state`; in prod clear `yjsSnapshotId` fields + delete the linked `_storage` blobs from Convex

### workerd TCMalloc crash (dev-only)

The local `partykit dev` server crashes with `Unable to allocate <huge number> (new failed)` — a TCMalloc memory corruption bug in the workerd binary bundled with partykit 0.0.115. This is **dev-environment only**; production on Cloudflare's edge is not affected (each Durable Object runs in its own isolate with a current workerd version). The crash persists across workerd versions (tested 2024-07-18, 2025-01-29, 2025-02-24) and is likely platform-specific (Fedora 42, kernel 6.18). The `dev:partykit` script auto-restarts on crash. A miniflare override to 3.20250224.0 is kept in `package.json` overrides as a best-effort mitigation.

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

### TypeScript
- Use `Id<"tableName">` for document ID types
- Use `Doc<"tableName">` for document types
- Functions returning nothing should have `returns: v.null()`

### UX principles
 - This app is opinionated on many topics, we don't want to please every possible user
 - Users should not be flooded with information, by default only essential information is visible
 - If the user desires more information it should be available and intuitively toggled / retrieved