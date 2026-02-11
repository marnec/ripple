# Phase 11: PartyKit Infrastructure & Persistence - Research

**Researched:** 2026-02-11
**Domain:** PartyKit WebSocket infrastructure with Yjs persistence on Cloudflare Durable Objects
**Confidence:** HIGH

## Summary

This research covers deploying a PartyKit server on Cloudflare with Yjs persistence, Convex-integrated authentication, snapshot compaction, and monorepo development workflow. PartyKit runs on Cloudflare Durable Objects (serverless WebSocket infrastructure) and provides built-in Yjs support via y-partykit with snapshot mode persistence. The project already uses Cloudflare (RTK for video calls) and has existing cursor tracking infrastructure (RTK-based, rate-limited at 5 events/s) that will be removed in favor of PartyKit/Yjs Awareness.

Key findings: PartyKit snapshot mode automatically compacts Yjs updates when sessions end or when 10MB storage limit is reached. Authentication should use Convex-generated tokens validated in onBeforeConnect. Document-level permissions are verified by calling Convex queries from PartyKit. The monorepo structure places PartyKit server code in `/partykit` directory with development workflow using npm-run-all/concurrently to run Vite + Convex + PartyKit dev servers in parallel.

**Primary recommendation:** Use PartyKit snapshot mode with Durable Objects persistence (baseline), implement document-level permission checks via Convex queries in onBeforeConnect, remove RTK cursor tracking in this phase, and integrate partykit dev into existing npm-run-all dev script.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Provider Choice:**
- PartyKit confirmed after evaluating y-webrtc + Cloudflare TURN (no persistence, P2P mesh doesn't scale, signaling server still needed) and Liveblocks (10 connections/room on free tier, vendor lock-in, higher cost)
- PartyKit runs on Cloudflare Durable Objects — aligns with existing Cloudflare usage (RTK for video calls)

**Auth Integration:**
- Document-level permissions enforced: PartyKit verifies the connecting user has access to the specific document/diagram, not just workspace membership
- Permission revocation: lazy — current session stays active, rejected on next reconnect (no real-time revocation)
- Room naming: type-prefixed — `doc-{documentId}`, `diagram-{diagramId}`

**Persistence & Backup:**
- Durable Objects snapshot mode is the baseline

**Project Structure & Dev Workflow:**
- PartyKit server code lives inside the monorepo: new `/partykit` directory at project root alongside `/src` and `/convex`
- Local dev: `npm run dev` starts Vite + Convex + PartyKit dev server (3 processes, single command)
- Production deploy: both `npm run deploy` script and CI auto-deploy on push to main
- RTK cursor cleanup: remove cursorSessions table/functions and use-cursor-tracking hook in this phase (don't wait for Phase 12)

### Claude's Discretion

- Auth mechanism choice (JWT vs token passthrough)
- Convex backup strategy and frequency
- Snapshot compaction approach and scheduling
- PartyKit server file structure within `/partykit`
- How to wire PartyKit dev server into existing concurrently-based dev script

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope

</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| partykit | 0.0.115 | PartyKit CLI and development tools | Official CLI for local dev server, deployment to Cloudflare, project management |
| partyserver | Latest | Base class for PartyKit servers | Official server API with lifecycle hooks (onConnect, onMessage, onBeforeConnect) |
| y-partykit | 0.0.33 | Yjs provider for PartyKit with built-in persistence | Official Yjs integration, snapshot mode persistence, automatic compaction, maintained by Cloudflare |
| yjs | 13.6.29 | CRDT library for collaborative editing | Industry standard, fastest CRDT implementation, state-based awareness for cursors, BlockNote integration |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| npm-run-all | 4.1.5 (already installed) | Run multiple npm scripts concurrently | Already in project, wire PartyKit dev into existing dev script |
| cloudflare-worker-jwt | Latest | JWT verification in Cloudflare Workers runtime | If implementing custom JWT auth (alternative to Convex token passthrough) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| PartyKit snapshot mode | PartyKit history mode | History mode preserves full edit history (offline support), but requires manual compaction triggers and grows unbounded until 10MB limit. Snapshot mode auto-compacts on session end, simpler for online-only collaboration. |
| Convex token passthrough | Custom JWT auth | Custom JWT requires signing/verification logic in both Convex and PartyKit. Token passthrough uses existing Convex auth tokens validated via Convex query, simpler integration. |
| npm-run-all | concurrently | Both support parallel execution. npm-run-all already in project (package.json line 94), prefer existing tooling. |
| Durable Objects persistence | Convex-only persistence | PartyKit with Convex-only persistence requires onLoad/onSave hooks on every update, adds latency. DO persistence is built-in, faster, allows optional Convex backup. |

**Installation:**
```bash
# PartyKit development (already have npm-run-all)
npm install -D partykit@0.0.115

# Core Yjs libraries (may already be installed from Phase 10 stack research)
npm install yjs@13.6.29 y-partykit@0.0.33

# Optional: JWT verification if not using Convex token passthrough
npm install cloudflare-worker-jwt
```

## Architecture Patterns

### Recommended Project Structure
```
/partykit/                  # PartyKit server code
  server.ts                 # Main PartyKit server entry point
  auth.ts                   # Authentication helpers (Convex token validation)
  yjs-server.ts             # y-partykit server configuration
  tsconfig.json             # PartyKit TypeScript config
partykit.json               # PartyKit configuration (port, persist, etc.)
```

**Integration with existing structure:**
```
/src                        # React frontend (existing)
/convex                     # Backend functions (existing)
/partykit                   # PartyKit server (NEW)
package.json                # Monorepo root with all dev scripts
```

### Pattern 1: Document-Level Permission Verification

**What:** Verify user has access to specific document/diagram before allowing PartyKit connection

**When to use:** Every PartyKit connection (onBeforeConnect hook)

**Example:**
```typescript
// partykit/server.ts
import type { Party, PartyConnection, PartyRequest } from "partyserver";

export default class CollaborationServer implements Party {
  constructor(readonly room: Party) {}

  // Static handler runs BEFORE connection accepted
  static async onBeforeConnect(
    request: PartyRequest,
    lobby: Party
  ): Promise<Response | void> {
    // Extract token from query string
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    const roomId = lobby.id; // e.g., "doc-abc123" or "diagram-xyz789"

    if (!token) {
      return new Response("Missing auth token", { status: 401 });
    }

    // Parse room type and resource ID
    const [roomType, resourceId] = roomId.split("-", 2);

    // Call Convex to verify permissions
    // Option 1: Use Convex action endpoint
    const convexUrl = lobby.env.CONVEX_SITE_URL;
    const verifyRes = await fetch(`${convexUrl}/api/actions/collaboration/verifyAccess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        resourceType: roomType, // "doc" or "diagram"
        resourceId
      }),
    });

    if (!verifyRes.ok) {
      return new Response("Unauthorized", { status: 403 });
    }

    const { userId, userName } = await verifyRes.json();

    // Pass user info to onConnect via headers
    const headers = new Headers(request.headers);
    headers.set("X-User-Id", userId);
    headers.set("X-User-Name", userName);

    // Return modified request (or void to accept)
    return new Request(request.url, {
      headers,
      method: request.method,
      body: request.body,
    });
  }

  onConnect(conn: PartyConnection, ctx: Party) {
    // User already verified, extract from headers
    const userId = conn.request.headers.get("X-User-Id");
    const userName = conn.request.headers.get("X-User-Name");

    // User can now access Yjs document
  }
}
```

**Why:** Document-level permissions prevent unauthorized access. PartyKit cannot directly query Convex database (different runtime), so must call Convex action/query endpoints. Lazy revocation acceptable (user loses access on next reconnect, not mid-session).

### Pattern 2: Snapshot Mode Persistence with Automatic Compaction

**What:** Use y-partykit snapshot mode which automatically merges Yjs updates into single snapshot when session ends

**When to use:** Default for all PartyKit rooms (both documents and diagrams)

**Example:**
```typescript
// partykit/yjs-server.ts
import { YPartyKitServer } from "y-partykit/server";

export default class YjsServer extends YPartyKitServer {
  constructor(room: Party) {
    super(room, {
      // Snapshot mode (default): merges updates on disconnect
      // History mode would preserve full edit history (not needed for v1)
      persist: {
        mode: "snapshot" // or omit, snapshot is default
      },

      // Convex backup via callback (optional)
      callback: {
        // Debounced save to Convex for backup
        debounceWait: 2000,      // 2s wait after last edit
        debounceMaxWait: 10000,  // 10s max wait
        handler: async (ydoc) => {
          // Encode Yjs state as binary update
          const update = Y.encodeStateAsUpdate(ydoc);

          // Save to Convex (optional backup)
          await fetch(`${this.room.env.CONVEX_SITE_URL}/api/actions/collaboration/saveSnapshot`, {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: update,
          });
        }
      }
    });
  }
}
```

**Configuration in partykit.json:**
```json
{
  "name": "ripple-collaboration",
  "main": "partykit/yjs-server.ts",
  "port": 1999,
  "persist": ".partykit/state",
  "compatibilityDate": "2026-02-11"
}
```

**Why:** Snapshot mode auto-compacts when last client disconnects (merges all updates → single snapshot). Prevents unbounded growth. History mode (alternative) would require manual compaction triggers and is designed for offline editing (not needed for v1 online-only collaboration).

### Pattern 3: Room Naming with Type Prefixes

**What:** Use type-prefixed room IDs (`doc-{documentId}`, `diagram-{diagramId}`) for isolation and permission scoping

**When to use:** All PartyKit connections (enforced in client code)

**Example:**
```typescript
// Frontend: src/hooks/use-yjs-provider.ts
import { useEffect, useMemo } from "react";
import { YPartyKitProvider } from "y-partykit/provider";
import * as Y from "yjs";

export function useYjsProvider(opts: {
  resourceType: "doc" | "diagram";
  resourceId: string;
  authToken: string; // from Convex action
}) {
  const { resourceType, resourceId, authToken } = opts;

  const yDoc = useMemo(() => new Y.Doc(), [resourceId]);

  const provider = useMemo(() => {
    const roomId = `${resourceType}-${resourceId}`;
    const host = import.meta.env.VITE_PARTYKIT_HOST || "localhost:1999";

    return new YPartyKitProvider(host, roomId, yDoc, {
      // Pass token as query param
      connect: true,
      params: { token: authToken },
    });
  }, [resourceType, resourceId, authToken, yDoc]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      provider.destroy();
      yDoc.destroy(); // CRITICAL: prevent memory leaks
    };
  }, [provider, yDoc]);

  return { yDoc, provider };
}
```

**PartyKit server extracts type:**
```typescript
static async onBeforeConnect(request: PartyRequest, lobby: Party) {
  const roomId = lobby.id; // "doc-abc123"
  const [roomType, resourceId] = roomId.split("-", 2);

  // Verify permissions based on roomType
  if (roomType === "doc") {
    // Check documents.by_id + documentMembers.by_document_user
  } else if (roomType === "diagram") {
    // Check diagrams.by_id + workspace membership via document
  }
}
```

**Why:** Type prefix allows single PartyKit server to handle both documents and diagrams with different permission models. Prevents confusion (document ID accidentally used for diagram room). Enables future room types (e.g., `task-{taskId}`, `board-{boardId}`).

### Pattern 4: Development Workflow with Concurrent Servers

**What:** Wire PartyKit dev server into existing npm-run-all-based dev script

**When to use:** Local development (`npm run dev`)

**Example:**
```json
// package.json
{
  "scripts": {
    "dev": "npm-run-all --parallel dev:frontend dev:backend dev:partykit",
    "dev:frontend": "vite --open",
    "dev:backend": "convex dev",
    "dev:partykit": "partykit dev",
    "predev": "convex dev --until-success && node setup.mjs --once && convex dashboard",

    "build": "tsc -b && vite build",
    "build:partykit": "partykit build",

    "deploy:convex": "npx convex deploy",
    "deploy:partykit": "CLOUDFLARE_ACCOUNT_ID=$CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN partykit deploy --domain collaboration.ripple.app",
    "deploy:frontend": "npm run build && wrangler deploy",
    "deploy": "npm-run-all build:partykit deploy:partykit deploy:convex deploy:frontend"
  }
}
```

**PartyKit configuration:**
```json
// partykit.json
{
  "name": "ripple-collaboration",
  "main": "partykit/yjs-server.ts",
  "port": 1999,
  "persist": ".partykit/state",
  "compatibilityDate": "2026-02-11",
  "define": {
    "CONVEX_SITE_URL": "$CONVEX_SITE_URL"
  }
}
```

**Why:** npm-run-all already in project (package.json line 7, 94). Adding dev:partykit to --parallel list runs 3 servers simultaneously. PartyKit defaults to port 1999, won't conflict with Vite (varies) or Convex dev (port not exposed). predev ensures Convex ready before starting all servers.

### Anti-Patterns to Avoid

- **Reusing single PartyKit room for cursors + docs:** Mixes ephemeral (cursors) and durable (document) state, hard to scale. Use separate Yjs providers: awareness-only for cursors, full sync for diagrams.
- **Storing Yjs updates without compaction:** Unbounded growth, slow loads. Snapshot mode handles this automatically.
- **Mixing ProseMirror Sync + Yjs for same document content:** Creates dual sync systems, conflicts. Phase 11 keeps ProseMirror Sync for BlockNote content, uses Yjs only for cursor awareness (Phase 12 may migrate fully to Yjs).
- **No permission check in PartyKit onConnect:** Anyone with room ID can join. Always verify in onBeforeConnect (static handler).
- **Creating new Y.Doc() on every render:** Memory leaks. Use useMemo + cleanup (doc.destroy(), provider.destroy()).
- **Broadcasting all cursor movements:** Rate limit issues, performance problems at scale. Use server-side batching or pause-based updates (only broadcast after 100ms pause).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebSocket server for Yjs | Custom WebSocket server with Yjs integration | y-partykit | Built-in snapshot persistence, Durable Objects scaling, hibernation support (future), automatic compaction |
| JWT verification in Cloudflare Workers | Custom crypto.subtle JWT parsing | cloudflare-worker-jwt OR Convex token passthrough | Edge-compatible JWT libraries are complex, Convex token passthrough simpler (call Convex query to verify) |
| Snapshot compaction logic | Manual Y.encodeStateAsUpdate + pruning | y-partykit snapshot mode | Automatic compaction on session end, configurable maxBytes/maxUpdates triggers |
| User presence tracking | Custom WebSocket broadcast of user positions | Yjs Awareness API | State-based CRDT for presence, built-in conflict resolution, automatic stale cleanup |
| Room-level permission checks | Custom database queries from PartyKit | Convex action/query endpoints | PartyKit can't directly access Convex database, must use HTTP API, Convex enforces auth |

**Key insight:** PartyKit + y-partykit provide production-ready WebSocket infrastructure with persistence, compaction, and scaling. Don't rebuild what Cloudflare Durable Objects already handle (WebSocket state, hibernation, isolation). Focus integration effort on auth (Convex → PartyKit token flow) and cleanup (existing RTK cursor tracking removal).

## Common Pitfalls

### Pitfall 1: No Document-Level Permission Verification

**What goes wrong:** PartyKit verifies user is authenticated (has valid token) but doesn't check if user has access to the specific document/diagram. Unauthorized users connect to rooms by guessing document IDs.

**Why it happens:** Developers assume workspace-level authentication is sufficient. But Ripple has private channels and document-level roles (REQUIREMENTS.md line 22-24: "Document-level roles"). User might be in workspace but not have access to specific private document.

**How to avoid:**
- In PartyKit onBeforeConnect, parse room ID to extract resource type and ID
- Call Convex query/action to verify user has access: `documentMembers.by_document_user` index check or `diagrams` ownership via workspace membership
- Return 403 Forbidden if permission check fails
- Document permission model in ARCHITECTURE.md: workspace member ≠ document access

**Warning signs:**
- Users report "I can see other people's private documents in collaboration"
- Security audit reveals room access without permission checks
- PartyKit logs show connections to documents user shouldn't access

### Pitfall 2: Yjs Memory Leaks from Undestroyed Documents

**What goes wrong:** User navigates between documents rapidly. Each document creates `Y.Doc` instance with providers. React cleanup disconnects providers but doesn't call `doc.destroy()`. Yjs docs accumulate in memory, browser tab crashes after visiting 50 documents.

**Why it happens:** Yjs providers handle WebSocket cleanup in `provider.destroy()`, but underlying `Y.Doc` persists in memory unless explicitly destroyed. Developers assume garbage collection happens automatically.

**How to avoid:**
- Call `doc.destroy()` in useEffect cleanup AFTER `provider.destroy()`
- Use useMemo to prevent creating new doc on every render: `useMemo(() => new Y.Doc(), [documentId])`
- Monitor memory in dev: log `performance.memory.usedJSHeapSize`, alert if >500MB
- Test in React StrictMode (mounts twice), verify no duplicate docs created
- Document lifecycle in code comments: "CRITICAL: destroy doc to prevent memory leak"

**Warning signs:**
- Browser memory usage grows continuously as user navigates documents
- Browser tab crashes after 30-60 minutes of active use
- DevTools heap snapshot shows dozens of `Y.Doc` instances for single document
- Console warnings: "WebSocket still connected after unmount"

### Pitfall 3: PartyKit Cold Start Latency

**What goes wrong:** User opens document, PartyKit server hibernated (cold). Server takes 2-5 seconds to start, initialize Yjs doc from Durable Objects storage, and establish WebSocket. During this time, user sees no cursors, presence list empty, feels like "collaboration is broken."

**Why it happens:** Cloudflare Workers (PartyKit backend) hibernate after inactivity. First user to room triggers cold start. Without Hibernation API, PartyKit room starts from scratch—new process, new memory, must load Yjs state from storage.

**How to avoid:**
- Show "Loading collaboration..." state immediately on document open
- Display user's own cursor/presence even before PartyKit connects (optimistic presence)
- Allow editing immediately, don't block on PartyKit connection (local-first)
- Connection state UI: `isConnected` from provider → green/yellow/red dot indicator
- Prefetch on navigation: start PartyKit connection when user clicks document in sidebar (before rendering DocumentEditor)

**Warning signs:**
- Users report "I don't see other people until 5 seconds after opening document"
- Cursor positions suddenly appear all at once (backlog of updates after cold start)
- First user to document always has degraded experience, subsequent users fine
- Metrics: p50 connection time <500ms, p95 connection time >3s (cold start outliers)

### Pitfall 4: Missing RTK Cursor Cleanup Creates Conflicts

**What goes wrong:** Existing RTK cursor tracking (`use-cursor-tracking.ts`, `convex/cursorSessions.ts`, `cursorSessions` table) left in place alongside new PartyKit cursors. Both systems broadcast cursor positions, causing duplicate cursors, rate limit errors (RTK 5 events/s limit still hit), and confusion about which system is authoritative.

**Why it happens:** Phase 11 implements PartyKit infrastructure, developers defer cleanup to "later phase" to reduce scope. But both systems run simultaneously, interfering with each other.

**How to avoid:**
- Remove RTK cursor code IN PHASE 11 (user constraint: "RTK cursor cleanup: remove cursorSessions table/functions and use-cursor-tracking hook in this phase (don't wait for Phase 12)")
- Delete files: `src/hooks/use-cursor-tracking.ts`, `convex/cursorSessions.ts`
- Drop table: Convex migration removes `cursorSessions` table and `by_document_active` index
- Update imports: Remove `use-cursor-tracking` imports from `DocumentEditor.tsx`, `CursorOverlay.tsx`
- Document in PLAN: "Remove RTK cursor tracking before implementing PartyKit cursors"

**Warning signs:**
- Duplicate cursors appear for same user
- Console errors: "Broadcast rate limit exceeded" (RTK still running)
- `cursorSessions` table still exists in schema.ts after Phase 11 complete
- Both `use-cursor-tracking` and PartyKit provider hooks used in same component

## Code Examples

Verified patterns from official sources:

### Convex Token Generation for PartyKit

```typescript
// convex/collaboration.ts
import { action } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const getCollaborationToken = action({
  args: {
    resourceType: v.union(v.literal("doc"), v.literal("diagram")),
    resourceId: v.string(), // document or diagram ID
  },
  returns: v.object({
    token: v.string(),
    roomId: v.string(),
  }),
  handler: async (ctx, { resourceType, resourceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Verify user has access to resource
    if (resourceType === "doc") {
      const member = await ctx.runQuery(internal.documentMembers.getByDocumentUser, {
        documentId: resourceId as Id<"documents">,
        userId,
      });
      if (!member) throw new Error("No access to document");
    } else if (resourceType === "diagram") {
      const diagram = await ctx.runQuery(internal.diagrams.getById, {
        id: resourceId as Id<"diagrams">,
      });
      if (!diagram) throw new Error("Diagram not found");
      // Check workspace membership via diagram.documentId
    }

    // Generate short-lived token (Convex auth token or custom JWT)
    // Option 1: Reuse Convex auth token (simpler)
    const token = (await ctx.auth.getUserIdentity())?.tokenIdentifier || "";

    // Option 2: Custom JWT with exp claim (more control)
    // const token = await generateJWT({ userId, resourceId, exp: Date.now() + 3600000 });

    const roomId = `${resourceType}-${resourceId}`;
    return { token, roomId };
  },
});
```

**Source:** [Convex Auth in Functions](https://docs.convex.dev/auth/functions-auth), [Authorization Best Practices](https://stack.convex.dev/authorization)

### PartyKit Server with Convex Permission Verification

```typescript
// partykit/server.ts
import type { Party, PartyConnection, PartyRequest } from "partyserver";

export default class CollaborationServer implements Party {
  constructor(readonly room: Party) {}

  static async onBeforeConnect(
    request: PartyRequest,
    lobby: Party
  ): Promise<Response | void> {
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    const roomId = lobby.id;

    if (!token) {
      return new Response("Missing auth token", { status: 401 });
    }

    // Call Convex to verify token + permissions
    const convexUrl = lobby.env.CONVEX_SITE_URL as string;
    const res = await fetch(`${convexUrl}/api/actions/collaboration/verifyAccess`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ roomId }),
    });

    if (!res.ok) {
      const error = await res.text();
      return new Response(`Unauthorized: ${error}`, { status: 403 });
    }

    const { userId, userName } = await res.json();

    // Pass user info to onConnect
    const headers = new Headers(request.headers);
    headers.set("X-User-Id", userId);
    headers.set("X-User-Name", userName);

    return new Request(request.url, { headers });
  }

  onConnect(conn: PartyConnection, ctx: Party) {
    const userId = conn.request.headers.get("X-User-Id");
    console.log(`User ${userId} connected to room ${this.room.id}`);
  }
}
```

**Source:** [PartyKit Authentication Guide](https://docs.partykit.io/guides/authentication/)

### Y-PartyKit Server with Snapshot Mode

```typescript
// partykit/yjs-server.ts
import { YPartyKitServer } from "y-partykit/server";
import * as Y from "yjs";

export default class YjsServer extends YPartyKitServer {
  constructor(room: Party) {
    super(room, {
      persist: {
        mode: "snapshot", // Auto-compact on session end
      },
      callback: {
        debounceWait: 2000,
        debounceMaxWait: 10000,
        handler: async (ydoc) => {
          // Optional: backup to Convex
          const update = Y.encodeStateAsUpdate(ydoc);
          const convexUrl = this.room.env.CONVEX_SITE_URL as string;

          await fetch(`${convexUrl}/api/actions/collaboration/saveSnapshot`, {
            method: "POST",
            headers: {
              "Content-Type": "application/octet-stream",
              "X-Room-Id": this.room.id,
            },
            body: update,
          });
        },
      },
    });
  }
}
```

**Source:** [Y-PartyKit API Reference](https://docs.partykit.io/reference/y-partykit-api/)

### Frontend Yjs Provider Hook with Cleanup

```typescript
// src/hooks/use-yjs-provider.ts
import { useEffect, useMemo } from "react";
import { YPartyKitProvider } from "y-partykit/provider";
import * as Y from "yjs";

export function useYjsProvider(opts: {
  resourceType: "doc" | "diagram";
  resourceId: string;
  authToken: string;
}) {
  const { resourceType, resourceId, authToken } = opts;

  // Memoize doc by resourceId to prevent recreating on every render
  const yDoc = useMemo(() => new Y.Doc(), [resourceId]);

  const provider = useMemo(() => {
    const roomId = `${resourceType}-${resourceId}`;
    const host = import.meta.env.VITE_PARTYKIT_HOST || "localhost:1999";

    return new YPartyKitProvider(host, roomId, yDoc, {
      connect: true,
      params: { token: authToken },
    });
  }, [resourceType, resourceId, authToken, yDoc]);

  // CRITICAL: Cleanup to prevent memory leaks
  useEffect(() => {
    return () => {
      provider.destroy(); // Disconnect WebSocket
      yDoc.destroy();     // Free memory
    };
  }, [provider, yDoc]);

  return { yDoc, provider, isConnected: provider.synced };
}
```

**Source:** [Yjs GitHub](https://github.com/yjs/yjs), [y-partykit npm](https://www.npmjs.com/package/y-partykit)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Cloudflare RTK for cursors | PartyKit/Yjs Awareness | 2026 (Phase 11) | RTK has 5 events/s rate limit (too slow for cursors). PartyKit uses Durable Objects WebSockets (no rate limit). |
| Separate cursor broadcast system | Yjs Awareness built-in | 2026 (Phase 11) | Unified cursor + presence via CRDT, automatic conflict resolution, no custom broadcast logic. |
| Manual WebSocket servers (y-websocket) | PartyKit serverless | 2024-2025 (PartyKit acquired by Cloudflare) | No server management, edge deployment, Durable Objects scaling, hibernation support. |
| partykit.io hosted service | Self-hosted on Cloudflare account | 2024 (Cloudflare acquisition) | partykit.io deprecated, deploy to own Cloudflare account (partykit deploy). |
| History mode default | Snapshot mode default | y-partykit 0.0.33 | Snapshot mode auto-compacts, simpler for online-only collaboration. History mode for offline editing. |

**Deprecated/outdated:**
- **partykit.io hosted service:** Deprecated after Cloudflare acquisition. Use `partykit deploy` to own Cloudflare account.
- **Mixing PartyKit with Hibernation + Yjs:** y-partykit currently doesn't support Hibernation API. Stay under 100 connections or use separate cursor-only rooms with Hibernation.
- **Cloudflare RTK for cursor tracking:** 5 events/s rate limit makes it unusable for real-time cursors (200ms throttle = 5 events/s theoretical max, no headroom).

## Open Questions

1. **Auth mechanism: Convex token passthrough vs custom JWT?**
   - What we know: Convex tokens can be validated via Convex query/action call from PartyKit. Custom JWT requires signing logic in Convex + verification in PartyKit (cloudflare-worker-jwt).
   - What's unclear: Performance impact of calling Convex on every connection vs local JWT verification. Token expiration handling (Convex tokens expire, need refresh).
   - Recommendation: Start with Convex token passthrough (simpler, leverage existing auth). Optimize to custom JWT if Convex call latency becomes bottleneck (measure p95 onBeforeConnect time).

2. **Convex backup frequency and storage strategy?**
   - What we know: y-partykit callback supports debounced saves (default 2s wait, 10s max). Yjs updates can be stored as binary blobs in Convex.
   - What's unclear: Optimal backup frequency (every edit? every N edits? daily?). Storage size implications (Yjs binary updates grow, need compaction). Whether to backup snapshots or full history.
   - Recommendation: Start with optional backup (not required for v1, Durable Objects are durable). If implemented, use callback with 10s debounce, store snapshots only (not full history). Monitor storage growth, implement Convex-side compaction if needed.

3. **Snapshot compaction scheduling beyond auto-compact?**
   - What we know: Snapshot mode auto-compacts when last client disconnects. maxBytes (10MB) and maxUpdates triggers available.
   - What's unclear: Whether auto-compact on disconnect is sufficient, or if background compaction needed (e.g., daily cron for stale rooms).
   - Recommendation: Start with auto-compact on disconnect (default). Monitor Durable Objects storage metrics. Add background compaction only if storage grows unexpectedly (documents with long-lived single-user sessions).

4. **PartyKit dev server integration: run in predev or parallel?**
   - What we know: Current predev runs `convex dev --until-success` then setup, then dashboard. Dev script uses npm-run-all --parallel for frontend + backend.
   - What's unclear: Should PartyKit dev run in predev (ensure ready before Vite) or in parallel (like Convex)? Port conflicts, startup dependencies.
   - Recommendation: Run PartyKit in --parallel with Vite and Convex. PartyKit dev server doesn't have startup dependencies (doesn't need Convex ready). Port 1999 won't conflict. Update to: `"dev": "npm-run-all --parallel dev:frontend dev:backend dev:partykit"`.

## Sources

### Primary (HIGH confidence)

- [PartyKit Authentication Guide](https://docs.partykit.io/guides/authentication/) - Token passing, onBeforeConnect verification
- [Y-PartyKit API Reference](https://docs.partykit.io/reference/y-partykit-api/) - Snapshot mode, history mode, persistence configuration
- [PartyKit Persisting State Guide](https://docs.partykit.io/guides/persisting-state-into-storage/) - Durable Objects storage API, limits, best practices
- [PartyKit Configuration Reference](https://docs.partykit.io/reference/partykit-configuration/) - partykit.json options, port, persist, define
- [PartyKit Deploy to Cloudflare Guide](https://docs.partykit.io/guides/deploy-to-cloudflare/) - Environment variables, deployment command
- [PartyKit CLI Reference](https://docs.partykit.io/reference/partykit-cli/) - partykit dev, partykit deploy commands
- [Convex Authorization Best Practices](https://stack.convex.dev/authorization) - Permission verification patterns, row-level security
- [Convex Auth in Functions](https://docs.convex.dev/auth/functions-auth) - getAuthUserId, user identity verification
- [Yjs GitHub Repository](https://github.com/yjs/yjs) - Y.Doc lifecycle, destroy(), encodeStateAsUpdate()
- [y-partykit npm package](https://www.npmjs.com/package/y-partykit) - Version 0.0.33, peer dependencies

### Secondary (MEDIUM confidence)

- [PartyKit Blog: Party.Server API](https://blog.partykit.io/posts/partyserver-api/) - onBeforeConnect static handler pattern
- [Convex npm run dev with package scripts](https://stack.convex.dev/npm-run-dev-with-package-scripts) - Concurrently dev script patterns
- [Yrs Architecture Deep Dive](https://www.bartoszsypytkowski.com/yrs-architecture/) - Yjs binary encoding, V1 vs V2, snapshot compaction
- [BlockNote Collaboration with PartyKit](https://www.blocknotejs.org/examples/collaboration/partykit) - y-prosemirror integration example

### Tertiary (LOW confidence - marked for validation)

- WebSearch: "PartyKit monorepo structure" - npm workspaces pattern (not specific to PartyKit, general monorepo guidance)
- WebSearch: "Cloudflare Workers external CI/CD" - Deployment patterns (official Cloudflare docs but not PartyKit-specific)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All packages verified via npm registry and official docs
- Architecture: HIGH - Patterns verified via official PartyKit docs, existing Ripple codebase (RTK cursor tracking), and Convex auth patterns
- Pitfalls: HIGH - Cross-referenced with .planning/research/PITFALLS.md (researched 2026-02-10), official docs, and existing code patterns
- Auth integration: MEDIUM - Convex token passthrough pattern inferred from docs, not explicit example (recommend prototyping in Phase 11 planning)
- Snapshot compaction: HIGH - y-partykit docs explicitly document snapshot mode auto-compaction on session end
- Dev workflow: HIGH - npm-run-all already in project, PartyKit CLI verified via official docs

**Research date:** 2026-02-11
**Valid until:** 2026-03-11 (30 days - PartyKit stable, Cloudflare-maintained post-acquisition)
