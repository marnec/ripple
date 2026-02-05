# Architecture

**Analysis Date:** 2026-02-05

## Pattern Overview

**Overall:** Layered Architecture with Real-Time Collaboration Features

**Key Characteristics:**
- Serverless backend (Convex) with RPC-style queries and mutations
- React frontend with React Router v6 for navigation
- Real-time synchronization using Convex Presence and ProseMirror Sync
- Role-based access control (RBAC) at workspace, channel, and document levels
- WebRTC for peer-to-peer video calls via signaling infrastructure

## Layers

**Presentation Layer (React Frontend):**
- Purpose: User interface and interactions
- Location: `src/pages/App/`, `src/components/`
- Contains: Page components, UI containers, form inputs, dialogs
- Depends on: Convex API client, React Router, shadcn/ui components
- Used by: Browser clients

**Route Navigation Layer:**
- Purpose: Map URLs to page components and manage navigation
- Location: `src/routes.tsx`
- Contains: Browser router configuration with nested routes
- Depends on: React Router v6, page components
- Used by: Root App component

**State Management & Data Layer:**
- Purpose: Fetch and synchronize data with backend
- Location: Convex client hooks (`useQuery`, `useMutation`), custom hooks in `src/hooks/`
- Contains: Custom hooks like `useEnhancedPresence`, `usePushNotifications`
- Depends on: Convex reactive query system, real-time APIs
- Used by: All page components

**Backend Query & Mutation Layer:**
- Purpose: Define public API endpoints and business logic
- Location: `convex/*.ts` (queries, mutations, actions)
- Contains: CRUD operations, authorization checks, data transformations
- Depends on: Database layer, Convex utility modules
- Used by: Frontend via `api` client, internal functions

**Database Schema & Relationships:**
- Purpose: Define data model and indexes
- Location: `convex/schema.ts`
- Contains: Table definitions with indexes, search indexes, validators
- Depends on: Convex schema API
- Used by: All queries and mutations

**Real-Time Synchronization:**
- Purpose: Enable collaborative editing and presence
- Location: `convex/presence.ts`, `convex/prosemirror.ts`, `convex/signaling.ts`
- Contains: Presence heartbeats, document sync, WebRTC signaling
- Depends on: Convex components, ProseMirror Sync library
- Used by: DocumentEditor, GroupVideoCall components

**Authentication & Authorization:**
- Purpose: User authentication and permission verification
- Location: `convex/auth.ts`, `convex/auth.config.ts`
- Contains: OAuth providers (GitHub), OTP/email auth, password reset
- Depends on: @convex-dev/auth, Resend email service
- Used by: All protected endpoints via `getAuthUserId`

**Shared Types & Constants:**
- Purpose: Centralized constants and type definitions
- Location: `shared/` directory
- Contains: Enums (`roles.ts`, `inviteStatus.ts`), types, constants
- Depends on: Nothing
- Used by: Both frontend and backend

## Data Flow

**User Authentication Flow:**

1. User visits `/auth` (unauthenticated)
2. LoginPage component renders auth options (GitHub, email OTP, password)
3. User submits credentials to Convex auth system
4. Convex stores session (via authTables in schema)
5. Frontend redirected to `/workspaces`
6. Layout checks `useQuery(api.users.viewer)` via UserContext
7. Authenticated routes render within App component

**Workspace Access Flow:**

1. User loads `/workspaces/:workspaceId`
2. Fetch workspace via `api.workspaces.get`
3. Check `workspaceMembers` table for current user membership
4. If no membership, return null (unauthorized)
5. Load workspace channels via `api.channels.list`
6. Channels filtered by workspace + membership
7. Load documents via `api.documents.list`

**Channel Message Flow:**

1. User navigates to channel via `/workspaces/:workspaceId/channels/:channelId`
2. ChatContainer component loads with `channelId` param
3. Chat component queries `api.messages.list` with pagination
4. Messages paginated in reverse chronological order
5. Batch-fetch user authors via `getAll` helper (prevents N+1)
6. User sends message via `api.messages.send` mutation
7. Message inserted with optimistic ID for local state
8. Convex query subscription updates message list real-time

**Document Collaboration Flow:**

1. User opens document via `/workspaces/:workspaceId/documents/:documentId`
2. DocumentEditor initializes ProseMirror sync via `useBlockNoteSync`
3. `api.prosemirror` sync API manages incremental changes (steps)
4. Presence heartbeats sent via `api.presence.heartbeat` mutation
5. Real-time presence list fetched via `api.presence.list` query
6. Cursor positions and user awareness rendered via `useEnhancedPresence`
7. Custom blocks (DiagramBlock, UserBlock) integrated into editor schema

**Video Call Signaling Flow:**

1. User joins call from `/workspaces/:workspaceId/channels/:channelId/videocall`
2. GroupVideoCall component initializes local MediaStream
3. Presence tracked with room ID: `video-call-${channelId}`
4. Offer/answer signals stored in `signals` table
5. ICE candidates queried and stored for WebRTC connection setup
6. Peer connections established via signaling messages
7. Remote streams collected and rendered to video elements
8. Call terminated via `api.signaling.deleteRoomSignal`

**State Management:**

- **Backend state:** Persistent in Convex database (authoritative)
- **Frontend query state:** Reactive subscriptions via Convex hooks
- **Frontend UI state:** Local React state (forms, UI toggles)
- **Real-time state:** Presence and document updates via Convex components
- **Optimistic updates:** Local changes rendered before server confirmation

## Key Abstractions

**Workspace Context:**
- Purpose: Container for channels, documents, and members with RBAC
- Files: `convex/workspaces.ts`, `convex/workspaceMembers.ts`
- Pattern: Owner creates workspace, becomes admin, adds members with roles
- Queries: `api.workspaces.list` (user's memberships), `api.workspaces.get`
- Mutations: `api.workspaces.create`, `api.workspaces.update`

**Channel Abstraction:**
- Purpose: Async message-based communication within workspaces
- Files: `convex/channels.ts`, `convex/channelMembers.ts`, `convex/messages.ts`
- Pattern: Public channels (auto-join members), private channels (explicit membership)
- Queries: `api.channels.list`, `api.messages.list` (paginated)
- Mutations: `api.channels.create`, `api.messages.send`
- Features: Full-text search on message plainText, deleted flag soft-deletes

**Document Abstraction:**
- Purpose: Real-time collaborative editing via BlockNote + ProseMirror
- Files: `convex/documents.ts`, `convex/documentMembers.ts`
- Pattern: Collaborative rich text with custom block types (diagrams)
- Queries: `api.documents.list`, `api.documents.get`
- Mutations: `api.documents.create`, `api.documents.rename`
- Sync: ProseMirror steps stored incrementally, snapshots for recovery

**Membership & RBAC:**
- Purpose: Control access to workspaces, channels, documents
- Files: `convex/workspaceMembers.ts`, `convex/channelMembers.ts`, `convex/documentMembers.ts`
- Pattern: Three-tier roles (admin/member) at each level
- Indexes: Composite indexes for efficient membership queries (by_workspace_user, by_channel_user, etc.)
- Checks: Every mutation verifies membership before allowing operations

**Diagram Abstraction:**
- Purpose: Embed Excalidraw diagrams in documents
- Files: `convex/diagrams.ts`, `src/pages/App/Diagram/`
- Pattern: Standalone diagrams linked to workspaces, editable via Excalidraw editor
- Queries: `api.diagrams.list`, `api.diagrams.get`
- Mutations: `api.diagrams.create`, `api.diagrams.update`
- Custom Block: DiagramBlock in `src/pages/App/Document/CustomBlocks/DiagramBlock.tsx`

**Presence & Awareness:**
- Purpose: Show active users and cursors in real-time
- Files: `convex/presence.ts`, `src/hooks/use-enhanced-presence.tsx`
- Pattern: Room-based presence with heartbeats + session tokens
- Mutations: `api.presence.heartbeat` (periodic), `api.presence.disconnect` (via sendBeacon)
- Queries: `api.presence.list` (room token parameter)
- Rooms: Document IDs, channel video calls (video-call-${channelId})

**Signaling for WebRTC:**
- Purpose: Coordinate peer-to-peer connections for video calls
- Files: `convex/signaling.ts`, `src/pages/App/GroupVideoCall/GroupVideoCall.tsx`
- Pattern: Pub/sub-like table with offer/answer/ICE-candidate records
- Mutations: `api.signaling.sendRoomSignal`, `api.signaling.deleteRoomSignal`
- Queries: `api.signaling.getOffers`, `api.signaling.getAnswers`, `api.signaling.getIceCandidates`
- Rooms: `video-call-${channelId}` format

## Entry Points

**Frontend Root:**
- Location: `src/main.tsx` (Vite entry)
- Triggers: Browser loads application
- Responsibilities: Mount React app with ConvexProvider, RouterProvider

**Protected App Wrapper:**
- Location: `src/pages/App/App.tsx`
- Triggers: Router navigates to authenticated routes
- Responsibilities: Verify user via `api.users.viewer`, render UserContext, handle invite redirects

**Layout Wrapper:**
- Location: `src/components/Layout.tsx`
- Triggers: App component renders for authenticated users
- Responsibilities: Render sidebar, header, breadcrumb, theme toggle, outlet for child routes

**Backend Functions:**
- Public endpoints: `query`, `mutation`, `action` exported from `convex/*.ts`
- Called by: Frontend via `api.<module>.<functionName>(args)`
- Available via: Generated `api` object from `convex/_generated/api.d.ts`

## Error Handling

**Strategy:** Throw ConvexError with descriptive messages, client-side caught by Convex hooks

**Patterns:**

**Authentication Checks:**
```typescript
// convex/channels.ts
const userId = await getAuthUserId(ctx);
if (!userId) throw new ConvexError("Not authenticated");
```

**Authorization Checks:**
```typescript
// convex/documents.ts
const membership = await ctx.db
  .query("documentMembers")
  .withIndex("by_document_user", (q) => q.eq("documentId", id).eq("userId", userId))
  .first();

if (membership?.role !== DocumentRole.ADMIN) {
  throw new ConvexError("You are not an admin of this document");
}
```

**Existence Validation:**
```typescript
// convex/messages.ts
const channel = await ctx.db.get(channelId);
if (!channel) throw new ConvexError(`Channel not found with id="${channelId}"`);
```

**Frontend Error Handling:**
- Convex hooks (`useQuery`, `useMutation`) surface errors in UI
- No explicit try/catch in components; errors propagate to Convex error boundary
- HTTP HTTP endpoints (pushNotifications, emails) use action error handling

## Cross-Cutting Concerns

**Logging:**
- Console logging in components for debugging
- No centralized logging service; relies on browser developer tools

**Validation:**
- Convex validators at mutation/query entry points (`v.string()`, `v.id("table")`)
- React form validation in components (e.g., input fields)
- Database constraints via schema types

**Authentication:**
- Convex Auth system (`@convex-dev/auth`) with OAuth (GitHub) and email OTP
- Session stored in `users` table (via authTables)
- `getAuthUserId(ctx)` called in every protected function
- Frontend wraps routes in `<Authenticated>` component

**Authorization:**
- Role-based at three levels: workspace (admin/member), channel (admin/member), document (admin/member)
- Custom membership tables (workspaceMembers, channelMembers, documentMembers)
- Every mutation checks role before allowing mutation
- Role count denormalized in channels/documents for efficient queries

**Notifications:**
- Push notifications via Web Push API
- Subscriptions stored in `pushSubscriptions` table
- Triggered for workspace invites, messages, etc. via `api.pushNotifications.notify`

---

*Architecture analysis: 2026-02-05*
