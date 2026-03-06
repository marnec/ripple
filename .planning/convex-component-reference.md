# Convex Component Building Reference

> Compiled from official Convex docs, Stack blog, and component source code.
> Use this as the authoritative reference when building a Convex component.

---

## Table of Contents

1. [Component Architecture Overview](#1-component-architecture-overview)
2. [Authoring a Component](#2-authoring-a-component)
3. [Schema & Data Model](#3-schema--data-model)
4. [Functions & Visibility](#4-functions--visibility)
5. [Client Code Patterns](#5-client-code-patterns)
6. [Isolation & Transaction Model](#6-isolation--transaction-model)
7. [OCC & Concurrency Fundamentals](#7-occ--concurrency-fundamentals)
8. [Contention Patterns & Solutions](#8-contention-patterns--solutions)
9. [Transaction Limits](#9-transaction-limits)
10. [Testing Components](#10-testing-components)
11. [NPM Packaging & Distribution](#11-npm-packaging--distribution)
12. [Reference Implementations](#12-reference-implementations)

---

## 1. Component Architecture Overview

Convex Components are self-contained backend modules that bundle **functions, schemas, and persistent state** into reusable units. They combine the best of:

- **Frontend components**: encapsulated, reusable, composable
- **External services**: strict data isolation, explicit API boundaries
- **Monolithic architecture**: transactional consistency across component calls (no distributed commit protocols)

### When to build a component (vs a library)

Build a **component** when you need to:
- Persist data to tables where you control the schema
- Isolate access to data behind an API boundary
- Define queries, mutations, and actions that run asynchronously
- Share functionality between apps in a predictable way

Build a **library** when you just need shared TypeScript utility functions with no persistent state.

### Capabilities

Components can use:
- Database tables with schema validation (reactive reads, transactional writes)
- Independent file storage (separate from main app)
- Durable scheduled functions for reliable future execution

### Key Restrictions

- **No `ctx.auth`** — pass user identifiers explicitly as arguments
- **No `process.env`** — pass config values as function arguments
- **No `.paginate()`** — use `paginator` from `convex-helpers` instead
- **All `Id<"table">` types convert to plain strings** in the ComponentApi (table ID encodings differ across components)

---

## 2. Authoring a Component

### Directory Structure

```
my-component/
├── _generated/          # Auto-generated (don't edit)
│   ├── api.ts           # Internal function references
│   ├── component.ts     # Exports ComponentApi type
│   ├── dataModel.ts     # Component data types
│   └── server.ts        # query/mutation/action builders
├── convex.config.ts     # Component definition
├── schema.ts            # Component schema
├── public.ts            # Public API functions
└── internal.ts          # Internal functions (not exposed)
```

### convex.config.ts

```typescript
import { defineComponent } from "convex/server";

const component = defineComponent("my_component");
// component.use(childComponent);  // optional child components
export default component;
```

- Name must be alphanumeric + underscores, typically `lowercase_with_underscores`
- Register child components via `.use()` with optional `{ name: "customName" }`

### Installing in an App

```typescript
// convex/convex.config.ts
import { defineApp } from "convex/server";
import myComponent from "@my-org/my-component/convex.config";

const app = defineApp();
app.use(myComponent);
// Multiple instances with different names:
app.use(myComponent, { name: "secondInstance" });
export default app;
```

Run `npx convex dev` to generate type-safe access via `import { components } from "./_generated/api";`

### Functions

Import builders from the component's own `_generated/server.js`:

```typescript
import { v } from "convex/values";
import { query, mutation } from "./_generated/server.js";

export const count = query({
  args: { name: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    // component has its own isolated ctx.db
    const docs = await ctx.db
      .query("shards")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .collect();
    return docs.reduce((sum, d) => sum + d.value, 0);
  },
});

export const add = mutation({
  args: { name: v.string(), count: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    // pick random shard, update it
    const shardIndex = Math.floor(Math.random() * 16);
    // ...
  },
});
```

**Critical**: All public component functions MUST have argument and return validators. Missing validators produce `any` types.

### Visibility Rules

- Public functions (`query`, `mutation`, `action`) are exposed in `ComponentApi`
- Internal functions (`internalQuery`, etc.) stay private
- Public functions become **internal references** when called from the app (never directly from clients)
- HTTP actions must be mounted in the app's `http.ts`

---

## 3. Schema & Data Model

Components define their own isolated schema:

```typescript
// schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  shards: defineTable({
    name: v.string(),
    shardIndex: v.number(),
    value: v.number(),
  }).index("by_name", ["name"])
    .index("by_name_shard", ["name", "shardIndex"]),

  globals: defineTable({
    defaultShards: v.number(),
  }),
});
```

### ID Types Across Boundaries

- `Id<"tableName">` from a component converts to `string` in the ComponentApi
- `v.id("table_name")` validators cannot reference tables from other components
- Document types (`Doc<"tableName">`) are only usable within the component

### Schema Validator Pattern

For return types, derive validators from schema:

```typescript
const shardDoc = schema.tables.shards.validator.extend({
  _id: v.id("shards"),
  _creationTime: v.number(),
});

export const getShard = query({
  args: { id: v.string() },  // string, not v.id()
  returns: v.nullable(shardDoc),
  handler: async (ctx, args) => { /* ... */ },
});
```

---

## 4. Functions & Visibility

### Calling Component Functions from App Code

```typescript
// In app code
await ctx.runQuery(components.myComponent.public.count, { name: "users" });
await ctx.runMutation(components.myComponent.public.add, { name: "users", count: 1 });
```

### Rules

- **Queries** can only call component **queries**
- **Mutations** can call component **queries and mutations**
- **Actions** can call component **queries, mutations, and actions**
- Reactive by default: queries into components participate in subscriptions

### CLI Execution

```bash
npx convex run --component myComponent public:count '{"name": "users"}'
```

---

## 5. Client Code Patterns

Components should ship client-side wrapper code. Four patterns, from simple to complex:

### Pattern 1: Standalone Functions

```typescript
import type { GenericMutationCtx, GenericDataModel } from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";

export async function addCount(
  ctx: Pick<GenericMutationCtx<GenericDataModel>, "runMutation">,
  component: ComponentApi,
  name: string,
  count: number,
) {
  await ctx.runMutation(component.public.add, { name, count });
}
```

### Pattern 2: Re-exported Functions

```typescript
export const add = mutation({
  args: { name: v.string(), value: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Add auth, rate limiting, etc.
    await ctx.runMutation(components.counter.public.add, args);
  },
});
```

### Pattern 3: Function Factory

```typescript
export function makeCounterAPI(component: ComponentApi, options) {
  return {
    add: mutation({
      args: { value: v.number() },
      handler: async (ctx, args) => {
        await options.auth(ctx, "write");
        return await ctx.runMutation(component.public.add, args);
      },
    }),
  };
}
```

### Pattern 4: Class-Based Client (recommended for complex components)

```typescript
import type { ComponentApi } from "../component/_generated/component.js";

export class ShardedCounter {
  constructor(
    public component: ComponentApi,
    private options?: { shards?: Record<string, number> },
  ) {}

  async inc(ctx: RunMutationCtx, name: string) {
    await ctx.runMutation(this.component.public.add, { name, count: 1 });
  }

  async count(ctx: RunQueryCtx, name: string): Promise<number> {
    return await ctx.runQuery(this.component.public.count, { name });
  }

  for(name: string) {
    return {
      inc: (ctx: RunMutationCtx) => this.inc(ctx, name),
      count: (ctx: RunQueryCtx) => this.count(ctx, name),
    };
  }
}
```

### Function Handles (Bidirectional Communication)

Enable components to call back into app functions:

```typescript
const handle = await createFunctionHandle(api.foo.bar);
// Pass as v.string() to component, which later casts:
const handle = handleString as FunctionHandle<"mutation">;
await ctx.runMutation(handle, args);
```

---

## 6. Isolation & Transaction Model

### Isolation Guarantees

- **Data isolation**: Component code cannot read data not explicitly provided (tables, files, env vars, scheduled functions)
- **Environmental isolation**: Global variable writes and system patches are not shared between components
- **One-directional**: App calls component, not vice versa (except via function handles)

### Transaction Behavior

- **Atomic commits**: All writes from a top-level mutation (including component calls) commit together
- **Sub-transaction isolation**: Each mutation call to a component is a sub-transaction
- **Error handling**: If a component mutation throws, only its writes roll back; the caller can catch and continue

```typescript
// App mutation
export const transfer = mutation({
  handler: async (ctx) => {
    try {
      await ctx.runMutation(components.ledger.debit, { amount: 100 });
    } catch (e) {
      // Component sub-transaction rolled back, app can handle gracefully
      await ctx.runMutation(components.ledger.logFailure, { error: e.message });
    }
  },
});
```

---

## 7. OCC & Concurrency Fundamentals

### How Convex OCC Works

Convex uses an **append-only transaction log** with monotonically increasing timestamps. Each transaction captures:

1. **Begin timestamp** — selects the database snapshot for all reads
2. **Read set** — precise record of all queried data ranges and document IDs
3. **Write set** — map of document IDs to proposed new values (buffered, not applied immediately)

At commit time, the **committer** (sole writer to the transaction log) checks: "Would this transaction have identical outcomes if executed at the new timestamp instead of its begin timestamp?"

- **No overlaps** between concurrent writes and the read set → commit succeeds
- **Overlaps detected** → OCC conflict error → automatic retry at a later timestamp

### Why Serializable Isolation

Convex provides **serializable** isolation (the strictest level). This means every transaction behaves as if it ran in single-threaded order. The argument:

> "Any isolation level less than serializable is too difficult a programming model for developers. Writing correct multithreaded code is difficult, and non-serializable transactions provide too little to the developer."

### Comparison with Postgres/MySQL Defaults

| Property | Convex | Postgres (default) | MySQL (default) |
|---|---|---|---|
| Isolation level | Serializable | Read Committed | Repeatable Read |
| Concurrency control | Optimistic (OCC) | Pessimistic (locks) | Pessimistic (locks) |
| Lost writes possible? | No | Yes (without SELECT FOR UPDATE) | Yes |
| Deadlocks possible? | No | Yes | Yes |
| Automatic retries? | Yes | No | No |

### Postgres READ COMMITTED Pitfall

By default, Postgres grabs the last committed value at the time of the SELECT. Two concurrent transactions reading the same row can both compute based on the same old value and overwrite each other's writes — silently losing data. This is the "lost $20" scenario.

### Optimistic vs Pessimistic Trade-offs

**Pessimistic (locking)**:
- More efficient in ideal conditions (no wasted work)
- Fragile: one slow/stuck transaction can block everything
- Deadlock risk when locking multiple records
- Back-pressure accumulates on the database server

**Optimistic (OCC)**:
- May waste work (retries on conflict)
- Resilient: slow transactions only affect themselves
- No deadlocks (no locks at all)
- Back-pressure stays on application servers (scalable, stateless)
- Composes better as codebases grow

---

## 8. Contention Patterns & Solutions

### The Fundamental Speed Limit

Any operation that takes N seconds on a contended record allows only 1/N operations per second. You cannot parallelize consistent operations on the same record. Breaking this limit requires one of:

1. **Speed up the operation** (shorter critical section)
2. **Introduce staleness** (relax consistency selectively)
3. **Reduce contention** (restructure data access)

### Pattern 1: Queue Pattern

**Problem**: A batch processor reads the entire table, conflicting with every enqueue mutation.

**Solution**: Separate read and write ranges on an index:

```typescript
// Enqueue writes at the "head" (_creationTime = now)
// Processor reads from the "tail" (old entries only)
const emails = await ctx.db
  .query("emails")
  .withIndex("by_creation_time", (q) =>
    q.lt("_creationTime", Date.now() - 30 * 1000)
  )
  .collect();
```

Insertions at one end, processing at the other → no conflicts.

### Pattern 2: Hot/Cold Table Separation

**Problem**: Frequently-updated fields (grades) live in the same document as rarely-read fields (email), causing unnecessary conflicts.

**Solution**: Split into separate tables:

```typescript
// Cold table: student contact info (read often, written rarely)
// Hot table: student grades (written often)
const gradeDoc = await ctx.db
  .query("studentGrades")
  .withIndex("by_student", (q) => q.eq("student", args.student))
  .unique();
```

Mutations on hot fields no longer conflict with reads of cold fields.

### Pattern 3: Predicate Locking

**Problem**: Two mutations both read the same balance document, even when there's no actual conflict.

**Solution**: Query only for abnormal states, not all states:

```typescript
// Instead of reading the balance every time:
// Only check for overdrawn accounts
const overdrawn = await ctx.db
  .query("balances")
  .withIndex("by_account", (q) =>
    q.eq("accountId", accountId).lt("balance", 0)
  )
  .unique();
```

If the balance stays positive, parallel mutations don't conflict.

### Pattern 4: Sharding (Staleness via Aggregation)

**Problem**: A single counter document updated by thousands of users.

**Solution**: Distribute across N shards, aggregate on read:

```typescript
// Write: pick random shard, increment it
const shardIndex = Math.floor(Math.random() * numShards);
const shard = await ctx.db
  .query("shards")
  .withIndex("by_name_shard", (q) =>
    q.eq("name", name).eq("shardIndex", shardIndex)
  )
  .unique();
await ctx.db.patch(shard._id, { value: shard.value + count });

// Read: sum all shards
const allShards = await ctx.db
  .query("shards")
  .withIndex("by_name", (q) => q.eq("name", name))
  .collect();
return allShards.reduce((sum, s) => sum + s.value, 0);
```

Trade-off: more shards = higher write throughput, but reads touch more documents.

### Pattern 5: Tree of Aggregation (Tax Collector Pattern)

**Problem**: Thousands of transactions targeting one record (the "king's ledger").

**Solution**: Introduce intermediary aggregators:

- Users pay tax collectors (4-5 relationships each, low contention)
- Tax collectors periodically batch-settle with the king (only 4 writers to king's ledger)
- Multiple levels deep if needed

This introduces **selective staleness** — the noble has paid, but the king won't see it until the next batch. Eventually consistent, zero-sum correct.

---

## 9. Transaction Limits

| Limit | Value |
|---|---|
| Mutation/query execution time | 1 second (user code only) |
| Action execution time | 10 minutes |
| Data read per transaction | 16 MiB |
| Data written per transaction | 16 MiB |
| Documents scanned per transaction | 32,000 |
| Documents written per transaction | 16,000 |
| Index ranges read | 4,096 calls to db.get/db.query |
| Function argument size | 16 MiB (5 MiB for Node actions) |
| Function return value | 16 MiB |
| Document size | 1 MiB |
| Fields per document | 1,024 |
| Nesting depth | 16 levels |
| Array elements | 8,192 |

**Implication for components**: Keep mutations fast (well under 1s). Shorter critical sections = higher throughput on contended records. If a component needs to process large datasets, use scheduled actions + batched mutations.

---

## 10. Testing Components

### Unit Testing Component Functions

```typescript
import { convexTest } from "convex-test";
import schema from "./schema.ts";

const modules = import.meta.glob("./**/*.ts");

test("add increments shard", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("shards", { name: "test", shardIndex: 0, value: 0 });
  });
  // Test mutation...
});
```

### Export Test Registration Helpers

```typescript
// test.ts (exported as @my-org/my-component/test)
export function register(t: TestConvex, name: string = "myComponent") {
  t.registerComponent(name, schema, modules);
}
```

### Integration Testing

Apps installing the component test the bundled version in realistic scenarios, exercising the full client code → component function → database path.

---

## 11. NPM Packaging & Distribution

### Build Process (order matters)

1. Component codegen: `npx convex codegen --component-dir ./path/to/component`
2. Package build: tsc/esbuild
3. Example app codegen: `npx convex dev --typecheck-components`

### package.json Entry Points

```json
{
  "name": "@my-org/my-component",
  "exports": {
    ".": "./dist/client/index.js",
    "./convex.config.js": "./dist/component/convex.config.js",
    "./_generated/component.js": "./dist/component/_generated/component.js",
    "./test": "./dist/component/test.js"
  }
}
```

### Quickstart

```bash
npx create-convex@latest --component
```

### Static Configuration Pattern

Store component config in a dedicated "globals" table with a single document:

```typescript
const config = await ctx.db.query("globals").first();
const numShards = config?.defaultShards ?? 16;
```

---

## 12. Reference Implementations

### Sharded Counter (`@convex-dev/sharded-counter`)

- **Purpose**: High-throughput counters via sharding
- **Schema**: `shards` table with `name`, `shardIndex`, `value` fields
- **Write**: Random shard selection → increment/decrement
- **Read**: Aggregate all shards for exact count, or sample 1-3 for estimate
- **API**: `inc`, `dec`, `add`, `subtract`, `count`, `estimateCount`, `rebalance`, `reset`
- **Default**: 16 shards per key
- **Config**: Per-key shard counts via constructor options

```typescript
const counter = new ShardedCounter(components.shardedCounter, {
  shards: { beans: 10, users: 3 },
});
const numUsers = counter.for("users");
await numUsers.inc(ctx);
const count = await numUsers.count(ctx);
```

### Aggregate (`@convex-dev/aggregate`)

- **Purpose**: Leaderboards, rankings, sorted aggregations
- **Pattern**: TableAggregate with namespace + sort key + sum value
- **Integration**: Uses Triggers from `convex-helpers` to auto-sync with table mutations

```typescript
const leaderboard = new TableAggregate<{
  Namespace: Id<"games">;
  Key: number;
  DataModel: DataModel;
  TableName: "guesses";
}>(components.leaderboard, {
  namespace: (d) => d.gameId,
  sortKey: (d) => d.score,
  sumValue: (d) => d.score,
});

// Usage
const topScore = await leaderboard.max(ctx, { namespace: gameId });
const rank = await leaderboard.indexOf(ctx, score, { namespace: gameId, id: docId, order: "desc" });
```

### Rate Limiter (`@convex-dev/ratelimiter`)

- **Purpose**: Token bucket / fixed window rate limiting with sharding
- **Pattern**: Sharded internally to avoid contention on rate limit checks

```typescript
const rate = new RateLimiter(components.ratelimiter, {
  anonymousSignIn: { kind: "token bucket", rate: 100, period: MINUTE, shards: 10 },
});
await rate.limit(ctx, "anonymousSignIn", { throws: true });
```

### Workpool (`@convex-dev/workpool`)

- **Purpose**: Queue + worker pattern for background job processing
- **Pattern**: Implements Queue, Hot/Cold, and Predicate Locking patterns internally

---

## Quick Checklist: Building a New Component

- [ ] Create component directory with `convex.config.ts` using `defineComponent`
- [ ] Define schema in `schema.ts` with proper indexes (use `withIndex`, never `filter`)
- [ ] Write public functions with full argument AND return validators
- [ ] Import builders from `./_generated/server.js` (not from `convex/server`)
- [ ] Design for OCC: minimize read sets, use sharding if high contention expected
- [ ] Ship client wrapper class (Pattern 4) for complex components
- [ ] Pass auth/env explicitly as arguments (no ctx.auth, no process.env)
- [ ] Export test helpers for `convex-test` integration
- [ ] Set up `package.json` exports for main, convex.config.js, _generated/component.js, and test
- [ ] Keep mutations fast (well under 1s transaction limit)
- [ ] Document trade-offs: shard count vs read latency, staleness guarantees, etc.
