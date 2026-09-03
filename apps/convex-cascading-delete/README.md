# Convex Cascading Delete

A Convex component for managing cascading deletes across related documents. Configure relationships via existing indexes, then delete documents safely knowing all related records will be cleaned up automatically with clear consistency guarantees.

## Why Use This Component?

- **Works with existing schemas** - No migration to special schema definitions; uses your existing `defineTable` and indexes
- **Explicit configuration** - Clear, declarative rules for cascade relationships defined in one place
- **Two deletion modes** - Inline (atomic, single transaction) for small trees, batched (streaming, scheduled) for trees of any size
- **No size ceiling in batched mode** - The tree is discovered as it is deleted; nothing ever enumerates it whole
- **Progress tracking** - React hook for real-time deletion progress with reactive updates
- **Safety guards** - Optional `patchDb` helper prevents accidental direct `db.delete` calls
- **Index validation** - Catch configuration errors at startup, not at delete time
- **Circular handling** - Diamonds and cycles are safe in both modes
- **Full observability** - Returns deletion summary with per-table document counts
- **Non-invasive** - Drop-in component that doesn't replace your schema builder or require code changes beyond deletion calls

## Pre-requisite: Convex

You'll need an existing Convex project to use this component. Convex is a hosted backend platform, including a database, serverless functions, and a bunch more you can learn about [here](https://docs.convex.dev/get-started).

Run `npm create convex` or follow any of the [Convex quickstarts](https://docs.convex.dev/home) to set one up.

## Installation

### Step 1: Install the package

```bash
npm install convex-cascading-delete
```

### Step 2: Add the component to your Convex app

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import convexCascadingDelete from "convex-cascading-delete/convex.config";

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
} from "convex-cascading-delete";
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

// Required for batched mode: the internal mutation that runs one step of a
// batched cascade. Pass the same `internalMutation` builder the rest of your
// app uses, so any database wrapping (triggers, custom contexts) applies here.
export const _cascadeBatchHandler = makeBatchDeleteHandler(internalMutation, cd);
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

For trees that may not fit one transaction, use batched mode:

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
      { batchHandlerRef: internal.cascading._cascadeBatchHandler }
    );
    // result.jobId can be used to track progress via useDeletionJobStatus hook
    // (null if the whole tree fit in this transaction)
    // result.initialSummary contains counts from the inline first step
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
const cd = new CascadingDelete(components.convexCascadingDelete, { rules, deleters });
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `component` | `ComponentApi` | Component reference from `components.convexCascadingDelete` |
| `options.rules` | `CascadeConfig` | Rules from `defineCascadeRules()` |
| `options.deleters` | `Record<string, TableDeleter>` (optional) | Per-table `(ctx, id, doc) => Promise<void>` called instead of `ctx.db.delete` — e.g. to drop a storage blob first. A deleter that throws is retried with a raw delete. |

#### `deleteWithCascade(ctx, table, id, options?)`

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
| `options.onComplete` | `(ctx, summary) => Promise<void>` (optional) | Called in the same transaction once the cascade is done |
| **Returns** | `DeletionSummary` | Map of table names to deleted document counts |

**Best for:** Small deletion trees — everything must fit one transaction's limits (see [Performance Characteristics](#performance-characteristics))

**Consistency:** Fully atomic - all deletes succeed or all fail within a single Convex transaction

#### `deleteWithCascadeBatched(ctx, table, id, options)`

Deletes a document and its dependents across a chain of transactions. The root row is deleted in the calling transaction along with as much of the tree as one transaction's budget allows; if anything is left, the traversal frontier is handed to the component, which schedules the batch handler once per step until the frontier is empty.

```ts
const result = await cd.deleteWithCascadeBatched(
  ctx,
  "organizations",
  orgId,
  {
    batchHandlerRef: internal.cascading._cascadeBatchHandler,
    batchSize: 500,           // Optional: rows deleted per transaction
    maxReadsPerBatch: 1024,   // Optional: index reads per transaction
    onComplete: internal.cascading.onCascadeDone,   // Optional
    onCompleteContext: { actorId },                  // Optional
  }
);
// Returns: { jobId: "j57a...", initialSummary: { organizations: 1, teams: 3 } }
// jobId is null if the whole tree fit in the first transaction
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `ctx` | `MutationCtx` | Convex mutation context |
| `table` | `string` | Source table name |
| `id` | `string` | Document ID to delete |
| `options.batchHandlerRef` | `FunctionReference<"mutation">` | Reference to your exported batch handler (from `makeBatchDeleteHandler`) |
| `options.batchSize` | `number` (optional) | Rows deleted per transaction, defaults to 500 |
| `options.maxReadsPerBatch` | `number` (optional) | Index reads (`db.query` / `db.get`) the cascade itself issues per transaction, defaults to 1024. Convex allows 4,096 per transaction; deleters and triggers spend from the same budget, so leave them headroom |
| `options.onComplete` | `FunctionReference<"mutation">` (optional) | Scheduled once when the job reaches a terminal state, with `{ summary, status, context }` (all strings; `summary` and `context` are JSON) |
| `options.onCompleteContext` | `Record<string, unknown>` (optional) | Passed through to `onComplete` as JSON |
| **Returns** | `{ jobId: string \| null, initialSummary: DeletionSummary }` | Job ID for tracking (null if everything was deleted inline) and the inline step's summary |

**Best for:** Any tree that might not fit one transaction — there is no size at which this stops working

**Consistency:** Per-step atomic, inter-step eventual. Parents are deleted before their children (pre-order), so between steps the tree is visible as children without a parent, never as a parent with half its children gone.

**Not supported:** rules with `softDeleteField`. A soft-deleted row stays in its index, which a streaming traversal would fetch again; batched mode throws up front if any rule sets it.

**Progress tracking:** Pass the returned `jobId` to the `useDeletionJobStatus` React hook

#### `cancelBatchJob(ctx, jobId)`

Cancels a running job. The step already scheduled still fires, finds the job cancelled, and stands down. No-op if the job is already in a terminal state.

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

### `makeBatchDeleteHandler(internalMutationBuilder, cd)`

Factory function that creates the app-side internal mutation running one step of a batched cascade. It must be exported from your convex code so the component's scheduler can invoke it via a function handle.

```ts
import { makeBatchDeleteHandler } from "convex-cascading-delete";
import { internalMutation } from "./_generated/server";
import { cd } from "./cascading";

export const _cascadeBatchHandler = makeBatchDeleteHandler(internalMutation, cd);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `internalMutationBuilder` | `InternalMutation` | Your app's `internalMutation` builder — the same one the rest of the app uses, so any database wrapping applies to cascade deletes too |
| `cd` | `CascadingDelete` | The configured instance: its rules and deleters drive the step, its component reference stores the result |
| **Returns** | `FunctionReference<"mutation">` | Internal mutation to pass as `batchHandlerRef` |

**How it works:** Each invocation loads the job's frontier from the component, spends one transaction's budget deleting and expanding, and reports back through the component, which schedules the next step or finalizes the job.

### React Hook

#### `useDeletionJobStatus(api, jobId)`

Monitors batch deletion progress with reactive updates. Wraps the component's `getJobStatus` query.

A batched cascade discovers the tree as it deletes it, so there is no total to compute a percentage from. `completedCount` grows as steps commit; `pendingCount` is how many parents are still being expanded.

```tsx
import { useDeletionJobStatus } from "convex-cascading-delete/react";
import { api } from "../convex/_generated/api";

function DeletionProgress({ jobId }: { jobId: string | null }) {
  const status = useDeletionJobStatus(api, jobId);

  if (!status) return null;

  return (
    <div>
      <p>
        {status.status}: {status.completedCount} documents deleted in {status.stepCount} steps
        {status.status === "processing" && ` (${status.pendingCount} parents pending)`}
      </p>
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
| `status` | `"processing" \| "completed" \| "failed" \| "cancelled"` | Current job state |
| `completedCount` | `number` | Documents deleted so far |
| `pendingCount` | `number` | Parents whose dependents are still being enumerated |
| `stepCount` | `number` | Transactions the cascade has used, the inline one included |
| `completedSummary` | `string` | JSON string mapping table names to deleted counts |
| `error` | `string \| undefined` | JSON string array of error messages, if any row could not be deleted |

## Exported Types

All types are importable from the main entry point:

```ts
import type {
  CascadeRule,       // { to: string; via: string; field: string; softDeleteField?: string }
  CascadeConfig,     // { [sourceTable: string]: CascadeRule[] }
  DeletionSummary,   // { [tableName: string]: number }
  TableDeleter,      // (ctx, id, doc) => Promise<void>
  FrontierEntry,     // { table, id, ruleIndex, probeId? } — persisted traversal state
  StepBudget,        // { deletes: number; reads: number }
  BatchJobStatus,    // { status, completedCount, pendingCount, stepCount, completedSummary, error? }
} from "convex-cascading-delete";
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

Both modes handle circular references. Inline mode keeps a visited set; batched mode deletes a row the moment it fetches it, so a row already gone cannot be fetched again. No infinite loops:

```ts
const rules = defineCascadeRules({
  users: [
    { to: "friendships", via: "byUserId", field: "userId" }
  ],
  friendships: [
    { to: "users", via: "byFriendId", field: "friendId" }
  ]
});

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

1. **Start with inline mode** - Use `deleteWithCascade` for trees you know are small; it's simpler and fully atomic
2. **Use batched mode for anything unbounded** - A table whose per-parent fanout has no ceiling (messages under a channel, tasks under a project) belongs in `deleteWithCascadeBatched`, whatever its size today
3. **Size the budgets for your deleters** - The defaults leave three quarters of Convex's read budget to deleters and triggers. If yours read a lot per row (aggregates, denormalized lookups), lower `batchSize` / `maxReadsPerBatch`
4. **Validate rules on startup** - Call `validateRules()` in a dev-only initialization function to catch misconfigured indexes early
5. **Use patchDb in critical mutations** - Prevent accidental direct deletes that would leave orphaned records
6. **Watch for `failed` jobs** - A failed job means rows the cascade could not delete were left behind; `error` names them. Have a reconciliation path for orphans
7. **Test cascade rules** - Verify relationships work as expected before production using the testing helpers

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  YOUR APP                                                            │
│                                                                      │
│  ┌──────────────────────────────────┐                                │
│  │  Your Mutation                   │                                │
│  │                                  │                                │
│  │  cd.deleteWithCascadeBatched(    │  ctx.db (YOUR tables)          │
│  │    ctx, "orgs", orgId, opts)     │─────► .get(root) → delete      │
│  │                                  │       .query(child)            │
│  │  1. delete the root row          │       .withIndex(idx, eq)      │
│  │  2. run one budgeted step        │       .take(page) → delete each│
│  │  3. frontier left? → createJob   │                                │
│  └──────────┬───────────────────────┘                                │
│             │ ctx.runMutation(component.lib.createJob, { frontier })  │
│             ▼                                                        │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  COMPONENT (Isolated — own DB, own transactions)             │    │
│  │                                                              │    │
│  │  Table: cascadeJobs                                          │    │
│  │    { status, frontier[], failedIds[], budgets, summary }     │    │
│  │                                                              │    │
│  │  createJob(frontier, …)  ──► scheduler.runAfter(0, handler)  │──┐ │
│  │  loadJob(jobId)          → frontier + budgets                │  │ │
│  │  saveStep(frontier, …)   ──► more? runAfter(0, handler)      │──┤ │
│  │                          ──► done? runAfter(0, onComplete)   │  │ │
│  │  getJobStatus(jobId)     → reactive query                    │  │ │
│  └──────────────────────────────────────────────────────────────┘  │ │
│             ▲                                                      │ │
│             │ runQuery(loadJob) / runMutation(saveStep)            │ │
│  ┌──────────┴───────────────────────────────────────────────────┐  │ │
│  │  Your Batch Handler (via makeBatchDeleteHandler)             │◄─┘ │
│  │                                                              │    │
│  │  handler: async (ctx, { jobId }) => {                        │    │
│  │    job = loadJob(jobId)                                      │    │
│  │    pop deepest parent → take(page) of its current rule       │    │
│  │      → delete each row now (deleter or db.delete)            │    │
│  │      → push rows that have rules of their own                │    │
│  │    repeat until frontier empty or budget spent               │    │
│  │    saveStep(jobId, frontier, summary, errors, done)          │    │
│  │  }                                                           │    │
│  └──────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

**Key architectural constraint:** Convex components cannot access your app's tables. All document traversal and deletion runs in your app's mutation context using `ctx.db`. The component only holds the state between steps — the frontier — in its own isolated database.

**Why the frontier stays small:** a row is deleted the moment it is fetched, so the frontier only ever holds parents that are already gone and still have dependents to enumerate — at most one page of siblings per level of your cascade graph, however wide the tree is. "The next page" of a parent is simply whatever its index still holds.

## Consistency Guarantees

### Inline Mode (`deleteWithCascade`)
- **Fully atomic** - All deletes succeed or all fail within a single Convex transaction
- **ACID compliant** - Leverages Convex's built-in transactional guarantees
- **Post-order** - Children are deleted before parents
- **Immediate** - Returns complete `DeletionSummary` synchronously

### Batched Mode (`deleteWithCascadeBatched`)
- **Per-step atomic** - Each step is a separate Convex transaction
- **Inter-step eventual** - Steps chain through the scheduler; the next is scheduled inside the transaction that commits the previous one
- **Pre-order** - The root goes in the calling transaction, dependents drain afterwards. Readers may see children without a parent, never a parent with half its children gone
- **Undeletable rows are skipped, not retried** - A row neither its deleter nor a raw delete can remove is recorded in `error`, skipped on every later page, and left for you to reconcile. More than 256 of them abort the job as `failed`
- **Progress observable** - Use `useDeletionJobStatus` hook or `getJobStatus` query for real-time status

## Performance Characteristics

| Characteristic | Detail |
|---|---|
| **Inline mode limit** | One transaction: 16,000 writes, 4,096 index reads (each rule query and `db.get` is one), 32,000 documents scanned |
| **Batched mode limit** | None. Each step is bounded by `batchSize` deletes and `maxReadsPerBatch` reads; the frontier is bounded by depth × page size |
| **Defaults** | `batchSize` 500, `maxReadsPerBatch` 1,024, page size 100 |
| **Traversal algorithm** | Inline: depth-first post-order. Batched: depth-first pre-order over a persisted stack |
| **Cycle handling** | Inline: `Set<string>` visited set. Batched: deleted rows cannot be fetched again |
| **Index usage** | Efficient `.withIndex()` queries — no table scans |
| **Steps per cascade** | Roughly `rows / batchSize`, or `(rows × rules per row) / maxReadsPerBatch` for rule-heavy tables, whichever is larger |

## Testing

The package exports a test helper for use with `convex-test`:

```ts
import { convexTest } from "convex-test";
import { register } from "convex-cascading-delete/test";
import schema from "./schema";

const modules = import.meta.glob("./convex/**/*.ts");

test("cascading delete works", async () => {
  const t = convexTest(schema, modules);
  register(t, "convexCascadingDelete");

  // ... your test code using the component.
  // Batched cascades chain scheduled steps: drain them with
  // await t.finishAllScheduledFunctions(vi.runAllTimers);
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
- **Batched delete** - Delete an organization across chained transactions with real-time progress
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
// { status: "processing", completedCount: 200, pendingCount: 3, stepCount: 4, ... }
```

A job whose `stepCount` stops growing while `processing` means a step failed to commit — most often a step that overran a Convex transaction limit because deleters or triggers read more than `maxReadsPerBatch` left them. Lower the budgets and delete again; the frontier is still there, but a new cascade from the same root is the simplest recovery (already-deleted rows are simply not found).

### Job finished as `failed`

`error` lists the rows no deleter could remove (and, past 256 of them, the abort). Those rows and their subtrees are still in your tables; reconcile them and re-run the cascade from the root if needed.

### Transaction limit exceeded in inline mode

Switch to batched mode:

```ts
// Instead of:
await cd.deleteWithCascade(ctx, "organizations", orgId);

// Use:
await cd.deleteWithCascadeBatched(ctx, "organizations", orgId, {
  batchHandlerRef: internal.cascading._cascadeBatchHandler,
});
```

### Type errors with table names

Use type assertions for dynamic table access:

```ts
const summary = await cd.deleteWithCascade(ctx, "users", userId as any);
```

## Found a bug? Feature request?

[File it here](https://github.com/akshatsinha0/convex-cascading-delete/issues).

## License

Apache-2.0

## Built For

[Convex Components Authoring Challenge](https://docs.convex.dev/components/authoring) - Full-Stack Drop-In Features
