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
