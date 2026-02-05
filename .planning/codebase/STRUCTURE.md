# Codebase Structure

**Analysis Date:** 2026-02-05

## Directory Layout

```
ripple/
├── src/                          # React frontend application
│   ├── pages/
│   │   ├── App/                 # Main authenticated app
│   │   │   ├── App.tsx          # Root authenticated component with UserContext
│   │   │   ├── AppSidebar.tsx   # Sidebar navigation
│   │   │   ├── Channel/         # Chat channels & video calls
│   │   │   ├── Chat/            # Message display & input
│   │   │   ├── Document/        # Collaborative document editor
│   │   │   ├── Diagram/         # Excalidraw diagram pages
│   │   │   ├── Workspace/       # Workspace management pages
│   │   │   └── GroupVideoCall/  # WebRTC video call component
│   │   ├── Authentication/      # Auth pages (LoginPage, etc.)
│   │   ├── LoginPage.tsx        # OAuth & email auth UI
│   │   ├── UserProfilePage.tsx  # User profile management
│   │   └── InviteAcceptPage.tsx # Workspace invite acceptance
│   ├── components/
│   │   ├── ui/                  # shadcn/ui components (auto-generated)
│   │   ├── Layout.tsx           # Main layout wrapper
│   │   ├── Breadcrumb.tsx       # Dynamic breadcrumb navigation
│   │   └── ThemeToggle.tsx      # Dark/light theme toggle
│   ├── hooks/                   # Custom React hooks
│   │   ├── use-enhanced-presence.tsx    # Presence tracking hook
│   │   ├── use-push-notifications.tsx   # Push notification setup
│   │   ├── use-device-id.tsx           # Unique device identifier
│   │   ├── use-mobile.tsx              # Mobile detection
│   │   └── use-sanitize.tsx            # HTML sanitization
│   ├── lib/
│   │   └── utils.ts             # cn() utility for Tailwind classes
│   ├── types/
│   │   └── (various .ts files)  # Frontend-only types
│   └── routes.tsx               # React Router v6 configuration
│
├── convex/                      # Serverless backend (Convex functions)
│   ├── schema.ts                # Database schema with indexes
│   ├── _generated/              # Auto-generated types (DO NOT EDIT)
│   │   ├── api.d.ts            # Function signatures
│   │   ├── dataModel.d.ts       # Database type definitions
│   │   └── server.js/server.d.ts # Convex runtime types
│   ├── auth.ts                  # Authentication setup (OAuth, OTP)
│   ├── auth.config.ts           # Auth configuration
│   ├── users.ts                 # User queries & mutations
│   ├── workspaces.ts            # Workspace CRUD
│   ├── workspaceMembers.ts      # Workspace membership management
│   ├── workspaceInvites.ts      # Workspace invite system
│   ├── channels.ts              # Channel CRUD & listing
│   ├── channelMembers.ts        # Channel membership & roles
│   ├── messages.ts              # Message CRUD with pagination & search
│   ├── documents.ts             # Document CRUD
│   ├── documentMembers.ts       # Document membership & roles
│   ├── diagrams.ts              # Diagram CRUD
│   ├── presence.ts              # Presence heartbeat & list
│   ├── prosemirror.ts           # Document sync (ProseMirror)
│   ├── signaling.ts             # WebRTC signaling for video calls
│   ├── pushSubscription.ts      # Push subscription management
│   ├── pushNotifications.ts     # Send push notifications (HTTP action)
│   ├── emails.ts                # Send emails via Resend
│   ├── breadcrumb.ts            # Generate breadcrumb paths
│   ├── http.ts                  # HTTP endpoints (if any)
│   └── convex.config.ts         # Convex project configuration
│
├── shared/                      # Shared types & constants
│   ├── enums/
│   │   ├── roles.ts            # WorkspaceRole, ChannelRole, DocumentRole
│   │   └── inviteStatus.ts     # Invite acceptance states
│   ├── types/
│   │   ├── routes.ts           # Route parameters (QueryParams)
│   │   ├── channel.ts          # Channel types
│   │   ├── document.ts         # Document types
│   │   ├── signals.ts          # WebRTC signal types
│   │   └── object.ts           # General object types
│   └── constants.ts            # App-wide constants
│
├── public/                      # Static assets
├── ssl/                         # SSL certificates (development)
├── .planning/
│   └── codebase/               # GSD codebase analysis docs
├── .cursor/                     # Cursor IDE rules
├── .claude/
│   └── skills/                 # Claude Code skills/context
├── vite.config.ts              # Vite build configuration
├── tsconfig.json               # TypeScript configuration
├── tailwind.config.ts          # Tailwind CSS configuration
├── package.json                # NPM dependencies & scripts
└── CLAUDE.md                   # Project guidance for Claude
```

## Directory Purposes

**src/pages/App/**
- Purpose: Authenticated application pages and layouts
- Contains: Page components for workspaces, channels, documents, diagrams
- Key files: `App.tsx` (root), `AppSidebar.tsx` (navigation)

**src/pages/App/Channel/**
- Purpose: Channel-related UI (chat, settings, video calls)
- Contains: ChannelDetails, ChannelSettings, ChannelSelectorList, CreateChannelDialog, ChannelVisibilityToggler
- Key files: `ChannelSettings.tsx`, `CreateChannelDialog.tsx`

**src/pages/App/Chat/**
- Purpose: Message display and input
- Contains: ChatContainer, Chat, MessageList, Message, MessageComposer, SearchDialog
- Key files: `Chat.tsx`, `MessageComposer.tsx`

**src/pages/App/Document/**
- Purpose: Collaborative document editor
- Contains: DocumentEditor, Documents, DocumentSettings, DocumentMembershipRole
- Key files: `DocumentEditor.tsx`, `CustomBlocks/` (DiagramBlock, UserBlock)
- Special: Uses BlockNote with ProseMirror sync for real-time collaboration

**src/pages/App/Diagram/**
- Purpose: Excalidraw diagram editing and listing
- Contains: DiagramPage, Diagrams, ExcalidrawEditor, DiagramSelectorList
- Key files: `ExcalidrawEditor.tsx`

**src/pages/App/Workspace/**
- Purpose: Workspace management
- Contains: Workspaces, WorkspaceDetails, WorkspaceSettings
- Key files: `WorkspaceSettings.tsx`

**src/pages/App/GroupVideoCall/**
- Purpose: WebRTC group video calls
- Contains: GroupVideoCall component with peer connection management
- Key files: `GroupVideoCall.tsx`

**src/pages/Authentication/**
- Purpose: Auth flows
- Contains: LoginPage, InviteAcceptPage, UserProfilePage
- Key files: `LoginPage.tsx`

**src/components/**
- Purpose: Reusable UI components
- Contains: Layout wrapper, breadcrumb, theme toggle, shadcn/ui library
- Auto-generated: ui/ subdirectory (generated from `npx shadcn-ui add`)

**src/hooks/**
- Purpose: Custom React hooks for shared logic
- Files:
  - `use-enhanced-presence.tsx`: Subscribe to presence in a room
  - `use-push-notifications.tsx`: Register/manage push notification subscriptions
  - `use-device-id.tsx`: Generate stable device identifier from localStorage
  - `use-mobile.tsx`: Detect mobile viewport
  - `use-sanitize.tsx`: Sanitize HTML content

**src/lib/**
- Purpose: Utility functions
- Files: `utils.ts` (cn() Tailwind utility)

**convex/schema.ts**
- Purpose: Define database schema with all tables and indexes
- Contains: Table definitions with field validators and composite indexes
- Tables: messages, workspaces, workspaceMembers, workspaceInvites, channels, channelMembers, signals, documents, documentMembers, diagrams, pushSubscriptions, plus authTables
- Critical for query performance via indexes (e.g., by_workspace, by_workspace_user, by_channel, by_document_user)

**convex/\*.ts (module files)**
- Purpose: Backend API functions organized by domain
- Pattern: Each file exports queries (read-only), mutations (write), and/or actions (external calls)
- Naming: `create`, `list`, `get`, `update`, `delete` are standard CRUD patterns
- Authorization: Every mutation includes auth check and permission validation

**convex/auth.ts & auth.config.ts**
- Purpose: Authentication configuration
- Contents: OAuth providers (GitHub), email OTP, password reset via Resend
- Integration: Uses @convex-dev/auth for session management

**convex/prosemirror.ts**
- Purpose: Document sync infrastructure
- Contents: ProseMirror Sync initialization with Convex components
- Used by: DocumentEditor via `useBlockNoteSync` hook

**convex/presence.ts**
- Purpose: Real-time presence tracking
- Contents: Heartbeat mutations, list query, disconnect cleanup
- Rooms: Any string ID (document IDs, video-call-${channelId})

**convex/signaling.ts**
- Purpose: WebRTC peer connection signaling
- Contents: Store and retrieve offer/answer/ICE-candidate messages
- Tables: Uses `signals` table with roomId, peerId, type, sdp, candidate

**shared/enums/**
- Purpose: Centralized enum definitions
- Files:
  - `roles.ts`: WorkspaceRole, ChannelRole, DocumentRole (admin/member)
  - `inviteStatus.ts`: Invite states (pending, accepted, rejected)

**shared/types/**
- Purpose: TypeScript types used by both frontend and backend
- Files:
  - `routes.ts`: QueryParams for useParams
  - `channel.ts`, `document.ts`: Data structure types
  - `signals.ts`: WebRTC signal types

**shared/constants.ts**
- Purpose: App-wide constants
- Contents: APP_NAME, EMAIL_DOMAIN, DEFAULT_DOC_NAME, ICE_SERVERS (STUN/TURN)

## Key File Locations

**Entry Points:**

| File | Purpose |
|------|---------|
| `src/main.tsx` | Vite entry point, mounts React app |
| `src/pages/App/App.tsx` | Root authenticated component, UserContext provider |
| `src/routes.tsx` | React Router configuration with all routes |
| `src/components/Layout.tsx` | Main layout with sidebar and header |

**Configuration:**

| File | Purpose |
|------|---------|
| `vite.config.ts` | Vite build configuration |
| `tsconfig.json` | TypeScript compiler options |
| `tailwind.config.ts` | Tailwind CSS customization |
| `convex/schema.ts` | Database schema and indexes |
| `convex/convex.config.ts` | Convex project settings |
| `convex/auth.config.ts` | Auth provider configuration |

**Core Logic:**

| File | Purpose |
|------|---------|
| `convex/workspaces.ts` | Workspace CRUD (create, list, get, update) |
| `convex/channels.ts` | Channel CRUD with public/private toggle |
| `convex/messages.ts` | Message CRUD with pagination and full-text search |
| `convex/documents.ts` | Document CRUD with auto-naming |
| `convex/channelMembers.ts` | Channel membership and role management |
| `convex/documentMembers.ts` | Document membership and role management |
| `convex/presence.ts` | Presence heartbeat and awareness |
| `convex/signaling.ts` | WebRTC offer/answer/ICE signaling |

**Frontend Features:**

| File | Purpose |
|------|---------|
| `src/pages/App/Chat/Chat.tsx` | Message list and composer |
| `src/pages/App/Document/DocumentEditor.tsx` | BlockNote editor with ProseMirror sync |
| `src/pages/App/GroupVideoCall/GroupVideoCall.tsx` | WebRTC peer connection management |
| `src/pages/App/Channel/ChannelSettings.tsx` | Channel visibility and member management |
| `src/pages/App/Document/DocumentSettings.tsx` | Document member management |

**Testing:**

| Location | Purpose |
|----------|---------|
| (Not found) | No test files present in codebase |

## Naming Conventions

**Files:**

- PascalCase for React components: `ChannelDetails.tsx`, `DocumentEditor.tsx`
- camelCase for utility/hook files: `use-enhanced-presence.tsx`, `utils.ts`
- camelCase for Convex backend modules: `messages.ts`, `workspaces.ts`
- Index files for exports: `shared/enums/index.ts`

**Directories:**

- PascalCase for feature directories: `Channel/`, `Document/`, `Workspace/`
- lowercase for utility directories: `hooks/`, `lib/`, `ui/`
- lowercase for backend: `convex/`

**React Components:**

- PascalCase component names: `export function ChatContainer() { }`
- Use `Container` suffix for route-level wrapper components: `ChatContainer`, `DocumentEditorContainer`
- Context exported as `XxxContext`: `UserContext` in App.tsx

**Functions:**

- camelCase: `getAuthUserId`, `sendMessage`, `createWorkspace`
- Hooks prefixed with `use`: `useQuery`, `useEnhancedPresence`, `usePushNotifications`
- API methods accessed via `api.<module>.<function>`: `api.messages.send`, `api.presence.heartbeat`

**Types:**

- PascalCase for interfaces and type aliases: `QueryParams`, `PeerData`
- Use `Doc<"tableName">` for Convex document types
- Use `Id<"tableName">` for Convex document IDs

## Where to Add New Code

**New Feature (e.g., Comments System):**

1. **Database Schema:** Add table(s) in `convex/schema.ts`
   - Define fields with validators
   - Add indexes for common queries (e.g., by_document, by_author)
   - Include search indexes if full-text search needed

2. **Backend Functions:** Create `convex/comments.ts`
   - Export `create`, `list`, `update`, `delete` mutations/queries
   - Add authorization checks (`getAuthUserId`, membership validation)
   - Use indexes with `withIndex()` for efficient queries

3. **Membership (if needed):** Create `convex/commentMembers.ts` or inline in comments.ts
   - Track who can access/edit comments
   - Add indexes by_document_user, by_document_author

4. **Frontend Pages:** Create `src/pages/App/Comment/CommentSection.tsx`
   - Use `useQuery(api.comments.list, { documentId })` to fetch
   - Use `useMutation(api.comments.create)` to send
   - Render list with create/edit/delete UI

5. **Add Routes:** Update `src/routes.tsx`
   - Add nested route under document or create standalone route

**New Component (e.g., UserAvatar):**

- Location: `src/components/UserAvatar.tsx` (shared) or `src/pages/App/Chat/UserAvatar.tsx` (feature-specific)
- Use shadcn/ui Avatar component from `src/components/ui/avatar.tsx`
- Export as PascalCase: `export function UserAvatar() { }`

**New Utility/Hook:**

- Utility: Add to `src/lib/utils.ts` or create `src/lib/[feature].ts`
- Hook: Create `src/hooks/use-[feature].tsx` with `use-` prefix
- Custom hook pattern: Call Convex hooks inside custom hook, expose simplified API

**New Shared Type/Enum:**

- Type: Add to `shared/types/[feature].ts`
- Enum: Add to `shared/enums/[feature].ts` and export from `shared/enums/index.ts`
- Constants: Add to `shared/constants.ts`

**New Authentication Flow:**

- Add provider to `convex/auth.ts` using @convex-dev/auth patterns
- Update auth.config.ts for environment variables
- No UI changes needed; LoginPage auto-discovers providers

## Special Directories

**convex/_generated/**
- Purpose: Auto-generated Convex types and client
- Generated by: `npm run dev` or `npx convex dev`
- Committed: Yes (part of version control)
- Edit: Never edit manually; regenerates on Convex function changes

**src/components/ui/**
- Purpose: shadcn/ui component library (auto-generated)
- Generated by: `npx shadcn-ui add [component]`
- Committed: Yes (custom modifications may exist)
- Edit: Safe to customize individual components

**.planning/codebase/**
- Purpose: GSD codebase analysis documentation
- Generated by: GSD map-codebase command
- Committed: Yes (for team reference)
- Edit: Reserved for GSD output

**.claude/skills/**
- Purpose: Custom Claude Code skills and context
- Contents: Skill definitions for TypeScript, Tailwind, Convex
- Edit: Yes, can add new skills for Claude guidance

**ssl/**
- Purpose: Local development SSL certificates
- Generated by: Development setup
- Committed: Typically not (security)

---

*Structure analysis: 2026-02-05*
