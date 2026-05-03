# Convex Cascading Delete

[![npm version](https://badge.fury.io/js/@00akshatsinha00%2Fconvex-cascading-delete.svg)](https://www.npmjs.com/package/@00akshatsinha00/convex-cascading-delete)

A Convex component for managing cascading deletes across related documents. Configure relationships via existing indexes, then delete documents safely knowing all related records will be cleaned up automatically with clear consistency guarantees.

## Why Use This Component?

- **Works with existing schemas** - No migration to special schema definitions; uses your existing `defineTable` and indexes
- **Explicit configuration** - Clear, declarative rules for cascade relationships defined in one place
- **Two deletion modes** - Inline (atomic, single transaction) for small deletes, batched (scheduled) for large trees
- **Progress tracking** - React hook for real-time batch deletion progress with reactive updates
- **Safety guards** - Optional `patchDb` helper prevents accidental direct `db.delete` calls
- **Index validation** - Catch configuration errors at startup, not at delete time
- **Circular handling** - Automatically handles circular and diamond dependencies via visited set
- **Full observability** - Returns deletion summary with per-table document counts
- **Non-invasive** - Drop-in component that doesn't replace your schema builder or require code changes beyond deletion calls

## Pre-requisite: Convex

You'll need an existing Convex project to use this component. Convex is a hosted backend platform, including a database, serverless functions, and a bunch more you can learn about [here](https://docs.convex.dev/get-started).

Run `npm create convex` or follow any of the [Convex quickstarts](https://docs.convex.dev/home) to set one up.

## Installation

### Step 1: Install the package

```bash
npm install @00akshatsinha00/convex-cascading-delete
```

### Step 2: Add the component to your Convex app

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import convexCascadingDelete from "@00akshatsinha00/convex-cascading-delete/convex.config";

const app = defineApp();
app.use(convexCascadingDelete);

export default app;
```

### Step 3: Configure cascade rules and instantiate

```ts
// convex/cascading.ts
import {
  CascadingDelete,
  defineCascadeRules,
  makeBatchDeleteHandler
} from "@00akshatsinha00/convex-cascading-delete";
import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";

export const cascadeRules = defineCascadeRules({
  users: [
    { to: "posts", via: "byAuthorId", field: "authorId" },
    { to: "comments", via: "byAuthorId", field: "authorId" }
  ],
  posts: [
    { to: "comments", via: "byPostId", field: "postId" }
  ]
});

export const cd = new CascadingDelete(components.convexCascadingDelete, {
  rules: cascadeRules
});

// Required for batched mode - exports an internal mutation that processes deletion batches
export const _cascadeBatchHandler = makeBatchDeleteHandler(
  internalMutation,
  components.convexCascadingDelete
);
```

## Quick Start

Use the configured `cd` instance in your mutations:

```ts
// convex/users.ts
import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { cd } from "./cascading";

export const deleteUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    // Deletes user + all their posts + all comments on those posts
    const summary = await cd.deleteWithCascade(ctx, "users", userId);
    console.log("Deleted:", summary);
    // Returns: { users: 1, posts: 5, comments: 23 }
  }
});
```

For large deletion trees, use batched mode:

```ts
// convex/organizations.ts
import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { cd } from "./cascading";

export const deleteOrganization = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const result = await cd.deleteWithCascadeBatched(
      ctx,
      "organizations",
      orgId,
      {
        batchHandlerRef: internal.cascading._cascadeBatchHandler,
        batchSize: 2000
      }
    );
    // result.jobId can be used to track progress via useDeletionJobStatus hook
    // result.initialSummary contains counts from the first inline batch
    return result;
  }
});
```

## API Reference

### `defineCascadeRules(config)`

Defines and validates cascade relationships between tables. Returns a frozen configuration object.

```ts
const rules = defineCascadeRules({
  [sourceTable: string]: [
    {
      to: string,       // Target table name to cascade to
      via: string,       // Index name on target table
      field: string      // Field in index used for equality matching (holds parent ID)
    }
  ]
});
```

**Requirements:**
- The index specified by `via` must exist on the target table
- The index must include the field specified by `field`
- The `field` must contain IDs from the source table

**Validation performed:**
- All properties (`to`, `via`, `field`) must be present and be strings
- Duplicate rules (same `to:via:field` combination) are rejected
- Configuration must be a non-null object

### `CascadingDelete` Class

Main interface for deletion operations.

#### Constructor

```ts
const cd = new CascadingDelete(components.convexCascadingDelete, { rules });
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `component` | `ComponentApi` | Component reference from `components.convexCascadingDelete` |
| `options.rules` | `CascadeConfig` | Rules from `defineCascadeRules()` |

#### `deleteWithCascade(ctx, table, id)`

Deletes a document and all its cascading dependents in a single transaction. Uses depth-first post-order traversal (children deleted before parents) with a visited set for cycle detection.

```ts
const summary: DeletionSummary = await cd.deleteWithCascade(ctx, "users", userId);
// Returns: { users: 1, posts: 5, comments: 23 }
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `ctx` | `MutationCtx` | Convex mutation context |
| `table` | `string` | Source table name |
| `id` | `string` | Document ID to delete |
| **Returns** | `DeletionSummary` | Map of table names to deleted document counts |

**Best for:** Small to medium deletion trees (fewer than 4,000 documents)

**Consistency:** Fully atomic - all deletes succeed or all fail within a single Convex transaction

#### `deleteWithCascadeBatched(ctx, table, id, options)`

Deletes a document and its dependents across multiple batched transactions. Collects all targets first via read-only traversal, deletes the first batch inline, then schedules remaining batches via the component's job system.

```ts
const result = await cd.deleteWithCascadeBatched(
  ctx,
  "organizations",
  orgId,
  {
    batchHandlerRef: internal.cascading._cascadeBatchHandler,
    batchSize: 2000  // Optional, defaults to 2000
  }
);
// Returns: { jobId: "j57a...", initialSummary: { organizations: 1, teams: 3 } }
// jobId is null if all targets fit in the first batch
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `ctx` | `MutationCtx` | Convex mutation context |
| `table` | `string` | Source table name |
| `id` | `string` | Document ID to delete |
| `options.batchHandlerRef` | `FunctionReference<"mutation">` | Reference to your exported batch handler (from `makeBatchDeleteHandler`) |
| `options.batchSize` | `number` (optional) | Documents per batch, defaults to 2000 |
| **Returns** | `{ jobId: string \| null, initialSummary: DeletionSummary }` | Job ID for tracking (null if all deleted inline) and first-batch summary |

**Best for:** Large deletion trees (any size)

**Consistency:** Per-batch atomic, inter-batch eventual. Each batch is a separate Convex transaction.

**Progress tracking:** Pass the returned `jobId` to the `useDeletionJobStatus` React hook

#### `validateRules(ctx)`

Validates that all configured indexes exist by probing each index with a test query. Should be called once during app initialization or in a dev-only check.

```ts
await cd.validateRules(ctx);
// Throws descriptive error if any index is missing or misconfigured
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `ctx` | `QueryCtx` | Convex query or mutation context |

#### `patchDb(db)`

Returns a proxied database writer that throws on direct `.delete()` calls, forcing all deletions to go through `deleteWithCascade`. Useful as a safety guard in critical mutations.

```ts
export const safeDeleteUser = mutation({
  handler: async (ctx, args) => {
    const safeDb = cd.patchDb(ctx.db);
    // safeDb.delete(id)  --> throws "Direct db.delete() is disabled"
    // safeDb.query(...)   --> works normally
    // safeDb.insert(...)  --> works normally
    // safeDb.patch(...)   --> works normally
  }
});
```

### `makeBatchDeleteHandler(internalMutationBuilder, componentRef)`

Factory function that creates the app-side internal mutation for processing deletion batches. This function must be exported from your convex code so the component's scheduler can invoke it via a function handle.

```ts
import { makeBatchDeleteHandler } from "@00akshatsinha00/convex-cascading-delete";
import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";

export const _cascadeBatchHandler = makeBatchDeleteHandler(
  internalMutation,
  components.convexCascadingDelete
);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `internalMutationBuilder` | `InternalMutation` | Your app's `internalMutation` builder from `_generated/server` |
| `componentRef` | `ComponentApi` | Component reference from `components.convexCascadingDelete` |
| **Returns** | `FunctionReference<"mutation">` | Internal mutation to pass as `batchHandlerRef` |

**How it works:** The returned mutation receives a batch of `{ table, id }` targets, deletes each one via `ctx.db.delete(id)`, then reports completion back to the component via `reportBatchComplete`. The component's scheduler calls this function handle with each batch.

### React Hook

#### `useDeletionJobStatus(api, jobId)`

Monitors batch deletion progress with reactive updates. Wraps the component's `getJobStatus` query.

```tsx
import { useDeletionJobStatus } from "@00akshatsinha00/convex-cascading-delete/react";
import { api } from "../convex/_generated/api";

function DeletionProgress({ jobId }: { jobId: string | null }) {
  const status = useDeletionJobStatus(api, jobId);

  if (!status) return null;

  const progress = (status.completedCount / status.totalTargetCount) * 100;

  return (
    <div>
      <progress value={progress} max={100} />
      <p>{status.status}: {status.completedCount} / {status.totalTargetCount}</p>
      {status.status === "completed" && (
        <pre>{JSON.stringify(JSON.parse(status.completedSummary), null, 2)}</pre>
      )}
    </div>
  );
}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `api` | `any` | Your app's `api` object from `_generated/api` |
| `jobId` | `string \| null` | Job ID from `deleteWithCascadeBatched`, or null to skip |
| **Returns** | `BatchJobStatus \| null` | Current job status, or null if no job / job not found |

**`BatchJobStatus` shape:**

| Field | Type | Description |
|-------|------|-------------|
| `status` | `"pending" \| "processing" \| "completed" \| "failed"` | Current job state |
| `totalTargetCount` | `number` | Total documents to delete |
| `completedCount` | `number` | Documents deleted so far |
| `completedSummary` | `string` | JSON string mapping table names to deleted counts |
| `error` | `string \| undefined` | Error message if job failed |

## Exported Types

All types are importable from the main entry point:

```ts
import type {
  CascadeRule,       // { to: string; via: string; field: string }
  CascadeConfig,     // { [sourceTable: string]: CascadeRule[] }
  DeletionSummary,   // { [tableName: string]: number }
  DeletionTarget,    // { table: string; id: string }
  BatchJobStatus,    // { status, totalTargetCount, completedCount, completedSummary, error? }
} from "@00akshatsinha00/convex-cascading-delete";
```

## Schema Requirements

Your schema must have indexes that match your cascade rules. Each rule's `via` must correspond to an index on the `to` table, and the `field` must be the first field in that index.

```ts
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
  }),

  posts: defineTable({
    authorId: v.id("users"),
    title: v.string(),
    content: v.string(),
  }).index("byAuthorId", ["authorId"]),  // Required for cascade from users

  comments: defineTable({
    authorId: v.id("users"),
    postId: v.id("posts"),
    text: v.string(),
  })
    .index("byAuthorId", ["authorId"])   // For user → comments cascade
    .index("byPostId", ["postId"]),      // For post → comments cascade
});
```

The corresponding cascade rules would be:

```ts
const rules = defineCascadeRules({
  users: [
    { to: "posts", via: "byAuthorId", field: "authorId" },
    { to: "comments", via: "byAuthorId", field: "authorId" }
  ],
  posts: [
    { to: "comments", via: "byPostId", field: "postId" }
  ]
});
```

## Examples

### Multi-Level Hierarchy

```ts
const rules = defineCascadeRules({
  organizations: [
    { to: "teams", via: "byOrganizationId", field: "organizationId" }
  ],
  teams: [
    { to: "members", via: "byTeamId", field: "teamId" },
    { to: "projects", via: "byTeamId", field: "teamId" }
  ],
  projects: [
    { to: "tasks", via: "byProjectId", field: "projectId" }
  ],
  tasks: [
    { to: "comments", via: "byTaskId", field: "taskId" }
  ]
});

// Deleting an organization cascades through 5 levels
const summary = await cd.deleteWithCascade(ctx, "organizations", orgId);
// Returns: { organizations: 1, teams: 5, members: 23, projects: 12, tasks: 67, comments: 234 }
```

### Branching Cascades

A single parent table can cascade to multiple dependent tables:

```ts
const rules = defineCascadeRules({
  users: [
    { to: "posts", via: "byAuthorId", field: "authorId" },
    { to: "comments", via: "byAuthorId", field: "authorId" },
    { to: "likes", via: "byUserId", field: "userId" },
    { to: "follows", via: "byFollowerId", field: "followerId" }
  ]
});
```

### Circular Dependencies

The component handles circular references automatically via a visited set. No infinite loops:

```ts
const rules = defineCascadeRules({
  users: [
    { to: "friendships", via: "byUserId", field: "userId" }
  ],
  friendships: [
    { to: "users", via: "byFriendId", field: "friendId" }
  ]
});

// Safe - visited set prevents re-processing already-seen documents
const summary = await cd.deleteWithCascade(ctx, "users", userId);
```

### Using patchDb as a Safety Guard

```ts
import { mutation } from "./_generated/server";
import { cd } from "./cascading";

export const processUser = mutation({
  handler: async (ctx, args) => {
    // Replace ctx.db with a guarded version for this mutation
    const safeCtx = { ...ctx, db: cd.patchDb(ctx.db) };

    // All reads work normally
    const user = await safeCtx.db.get(args.userId);

    // Direct deletes are blocked - forces cascade usage
    // safeCtx.db.delete(args.userId)  --> throws Error

    // Must use cascade delete instead
    await cd.deleteWithCascade(ctx, "users", args.userId);
  }
});
```

## Best Practices

1. **Start with inline mode** - Use `deleteWithCascade` for most cases; it's simpler and fully atomic
2. **Switch to batched for large trees** - Use `deleteWithCascadeBatched` when deleting more than 4,000 documents to avoid transaction limits
3. **Validate rules on startup** - Call `validateRules()` in a dev-only initialization function to catch misconfigured indexes early
4. **Use patchDb in critical mutations** - Prevent accidental direct deletes that would leave orphaned records
5. **Monitor batch progress** - Use the `useDeletionJobStatus` hook to show users real-time deletion feedback
6. **Test cascade rules** - Verify relationships work as expected before production using the testing helpers

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  YOUR APP                                                       │
│                                                                 │
│  ┌──────────────────────────────────┐                           │
│  │  Your Mutation                   │                           │
│  │                                  │                           │
│  │  const cd = new CascadingDelete( │                           │
│  │    components.convexCascadingDel,│                           │
│  │    { rules: cascadeRules }       │                           │
│  │  );                              │                           │
│  │                                  │  ctx.db (YOUR tables)     │
│  │  // Inline mode:                 │─────► .query(table)       │
│  │  cd.deleteWithCascade(ctx,       │       .withIndex(idx,...) │
│  │    "teams", teamId)              │       .collect()          │
│  │                                  │       .delete(id)         │
│  │  // Batched mode:                │                           │
│  │  cd.deleteWithCascadeBatched(ctx,│                           │
│  │    "teams", teamId, opts)        │                           │
│  │                                  │                           │
│  └──────────┬───────────────────────┘                           │
│             │                                                   │
│             │ ctx.runMutation(component.lib.createBatchJob, ...)│
│             │ ctx.runQuery(component.lib.getJobStatus, ...)     │
│             ▼                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  COMPONENT (Isolated — own DB, own transactions)         │   │
│  │                                                          │   │
│  │  Table: deletionJobs                                     │   │
│  │    { status, targets, deleteHandle, batchSize, summary } │   │
│  │                                                          │   │
│  │  Functions:                                              │   │
│  │    createBatchJob(targets, handle, batchSize)            │   │
│  │    processNextBatch(jobId)                               │   │
│  │      ├─ scheduler.runAfter(0, deleteHandle, batch)     ──┼──►│
│  │      └─ scheduler.runAfter(200ms, self, jobId)           │   │
│  │    getJobStatus(jobId) → reactive query                  │   │
│  │    reportBatchComplete(jobId, summary)                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│             │                                                   │
│             │ Function handle callback                          │
│             ▼                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Your Batch Delete Handler (via makeBatchDeleteHandler)  │   │
│  │                                                          │   │
│  │  handler: async (ctx, { targets, jobId }) => {           │   │
│  │    for (t of targets) await ctx.db.delete(t.id);         │   │
│  │    await ctx.runMutation(component.reportBatchComplete,  │   │
│  │      { jobId, summary });                                │   │
│  │  }                                                       │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Key architectural constraint:** Convex components cannot access your app's tables. All document traversal and deletion runs in your app's mutation context using `ctx.db`. The component only manages batch job state (creation, progress, completion) in its own isolated database.

## Consistency Guarantees

### Inline Mode (`deleteWithCascade`)
- **Fully atomic** - All deletes succeed or all fail within a single Convex transaction
- **ACID compliant** - Leverages Convex's built-in transactional guarantees
- **Immediate** - Returns complete `DeletionSummary` synchronously

### Batched Mode (`deleteWithCascadeBatched`)
- **Per-batch atomic** - Each batch is a separate Convex transaction
- **Inter-batch eventual** - Batches process asynchronously with 200ms delay between them
- **First batch inline** - Initial batch is deleted in the calling mutation for immediate feedback
- **Remaining batches scheduled** - Processed via the component's scheduler using function handles
- **Progress observable** - Use `useDeletionJobStatus` hook or `getJobStatus` query for real-time status

## Performance Characteristics

| Characteristic | Detail |
|---|---|
| **Inline mode limit** | ~4,000 documents (based on Convex's 16K write limit per transaction) |
| **Batch size** | Configurable, defaults to 2,000 documents per batch |
| **Traversal algorithm** | Depth-first, post-order (children deleted before parents) |
| **Cycle detection** | O(1) lookup per document via `Set<string>` |
| **Index usage** | Efficient `.withIndex()` queries — no table scans |
| **Batch scheduling delay** | 200ms between batches to prevent scheduler flooding |
| **Convex limits respected** | 16K writes, 32K document scans, 4,096 index reads, 1s execution per transaction |

## Testing

The package exports a test helper for use with `convex-test`:

```ts
import { convexTest } from "convex-test";
import { register } from "@00akshatsinha00/convex-cascading-delete/test";
import schema from "./schema";

const modules = import.meta.glob("./convex/**/*.ts");

test("cascading delete works", async () => {
  const t = convexTest(schema, modules);
  register(t, "convexCascadingDelete");

  // ... your test code using the component
});
```

The `register` function registers the component's schema and modules with the test instance. The second argument must match the component name in your `convex.config.ts`.

## Running the Example

The `example/` directory contains a full working application demonstrating both inline and batched deletion modes with a 5-level organizational hierarchy.

```bash
# Clone the repository
git clone https://github.com/akshatsinha0/convex-cascading-delete.git
cd convex-cascading-delete

# Install dependencies
npm install

# Start the dev server (backend + frontend + build watcher)
npm run dev
```

The example app includes:
- **Seed data buttons** - Create sample organizations with teams, members, projects, tasks, and comments
- **Inline delete** - Delete an organization atomically in a single transaction
- **Batched delete** - Delete an organization across multiple batched transactions with real-time progress
- **Document counters** - See counts update reactively across all 6 tables
- **REST API** - HTTP endpoint at `/api/deletion-job-status?jobId=...` for external job monitoring

## Troubleshooting

### "Index does not exist" error

Run `validateRules()` to identify missing indexes:

```ts
await cd.validateRules(ctx);
// Error: Cascade validation failed: Index "byAuthorId" with field "authorId"
// does not exist on table "posts". Define it in your schema.
// Source table: "users"
```

Add the missing index to your schema with `.index("indexName", ["fieldName"])`.

### Batch deletion stuck

Check job status directly:

```ts
const status = await ctx.runQuery(
  components.convexCascadingDelete.lib.getJobStatus,
  { jobId }
);
console.log(status);
// { status: "processing", totalTargetCount: 500, completedCount: 200, ... }
```

If a job is stuck in `"processing"` state, it may be due to the batch handler function not being properly exported or a deployment mismatch.

### Transaction limit exceeded

If inline mode fails with a transaction limit error, switch to batched mode:

```ts
// Instead of:
await cd.deleteWithCascade(ctx, "organizations", orgId);

// Use:
await cd.deleteWithCascadeBatched(ctx, "organizations", orgId, {
  batchHandlerRef: internal.cascading._cascadeBatchHandler,
  batchSize: 1000  // Reduce batch size if needed
});
```

### Type errors with table names

Use type assertions for dynamic table access:

```ts
const summary = await cd.deleteWithCascade(ctx, "users", userId as any);
```

## Live Demo

Try the interactive demo: [https://convex-cascading-delete.vercel.app](https://convex-cascading-delete.vercel.app)

## Found a bug? Feature request?

[File it here](https://github.com/akshatsinha0/convex-cascading-delete/issues).

## License

Apache-2.0

## Built For

[Convex Components Authoring Challenge](https://docs.convex.dev/components/authoring) - Full-Stack Drop-In Features
