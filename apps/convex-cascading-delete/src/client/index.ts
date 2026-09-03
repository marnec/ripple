/*
(1.) Primary client API for cascading delete operations in application context
(2.) Inline mode: depth-first post-order traversal in one transaction
(3.) Batched mode: a streaming traversal spread over a chain of transactions

This module exports the CascadingDelete class which serves as the main interface
for applications using the component. Inline mode performs complete traversal and
deletion in a single transaction using post-order depth-first search with a
visited set for cycle prevention. Batched mode never materializes the deletion
tree: each transaction pops the deepest parent off a persisted frontier, fetches
one page of its dependents, deletes them on the spot, and pushes the ones that
have rules of their own. A row is deleted the moment it is fetched, so the
frontier is bounded by depth × page size regardless of how large the tree is,
and the next page of a parent is simply "whatever the index still holds".
*/

import { createFunctionHandle } from "convex/server";
import { v } from "convex/values";
import type {
  GenericMutationCtx,
  GenericDataModel,
  FunctionReference,
  FunctionVisibility,
} from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";
import type {
  CascadeConfig,
  DeletionSummary,
  FrontierEntry,
  StepBudget,
  TableDeleter,
} from "../component/types.js";

export { defineCascadeRules } from "../component/config.js";
export type {
  CascadeConfig,
  CascadeRule,
  DeletionSummary,
  FrontierEntry,
  StepBudget,
  BatchJobStatus,
  TableDeleter,
} from "../component/types.js";

type MutationCtx = {
  db: any;
  runMutation: GenericMutationCtx<GenericDataModel>["runMutation"];
  runQuery: GenericMutationCtx<GenericDataModel>["runQuery"];
  scheduler: GenericMutationCtx<GenericDataModel>["scheduler"];
  storage: GenericMutationCtx<GenericDataModel>["storage"];
};

type QueryCtx = {
  db: any;
};

/** Rows fetched per index page while expanding a parent. */
export const PAGE_SIZE = 100;
/** Default rows deleted per transaction of a batched cascade. */
export const DEFAULT_BATCH_SIZE = 500;
/**
 * Default index reads per transaction issued by the cascade itself. Convex
 * allows 4,096 per transaction; deleters and triggers spend from the same
 * budget, so the default leaves them three quarters of it.
 */
export const DEFAULT_MAX_READS_PER_BATCH = 1024;
/** Mirrors the component's cap; a step gives up past it. */
const MAX_FAILED_IDS = 256;
/** Mirrors the component's cap on the persisted frontier. */
const MAX_FRONTIER = 4096;

/** Mutable per-step scratch state shared by the inline and scheduled steps. */
type StepState = {
  frontier: FrontierEntry[];
  failedIds: Set<string>;
  summary: DeletionSummary;
  errors: string[];
};

/**
 * Main class for managing cascading delete operations.
 *
 * @example
 * ```typescript
 * const cd = new CascadingDelete(components.convexCascadingDelete, {
 *   rules: cascadeRules
 * });
 *
 * // Inline mode (small deletes)
 * const summary = await cd.deleteWithCascade(ctx, "users", userId);
 *
 * // Batched mode (any size)
 * const { jobId } = await cd.deleteWithCascadeBatched(ctx, "users", userId, {
 *   batchHandlerRef: internal.cascading._cascadeBatchHandler,
 * });
 * ```
 */
export class CascadingDelete {
  readonly rules: CascadeConfig;
  readonly component: ComponentApi;
  private deleters: Record<string, TableDeleter>;

  constructor(component: ComponentApi, options: {
    rules: CascadeConfig;
    deleters?: Record<string, TableDeleter>;
  }) {
    this.component = component;
    this.rules = options.rules;
    this.deleters = options.deleters ?? {};
  }

  /**
   * Deletes a document and all its cascading dependents in a single transaction.
   * Uses depth-first post-order traversal with cycle detection.
   *
   * @param ctx - Mutation context with db access
   * @param table - Source table name
   * @param id - Document ID to delete
   * @returns Summary of documents deleted per table
   */
  async deleteWithCascade<Ctx extends MutationCtx>(
    ctx: Ctx,
    table: string,
    id: string,
    options?: {
      onComplete?: (ctx: Ctx, summary: DeletionSummary) => Promise<void>;
    }
  ): Promise<DeletionSummary> {
    const visited = new Set<string>();
    const summary: DeletionSummary = {};

    await this.collectAndDelete(ctx, table, id, visited, summary);

    if (options?.onComplete) {
      await options.onComplete(ctx, summary);
    }

    return summary;
  }

  /**
   * Internal recursive function for traversal and deletion.
   * Post-order: deletes children before parents.
   * Supports custom deleters, soft delete via softDeleteField on rules.
   */
  private async collectAndDelete(
    ctx: MutationCtx,
    table: string,
    id: string,
    visited: Set<string>,
    summary: DeletionSummary,
    softDeleteField?: string
  ): Promise<void> {
    const key = `${table}:${id}`;
    if (visited.has(key)) {
      return;
    }
    visited.add(key);

    const rules = this.rules[table] || [];

    for (const rule of rules) {
      const dependents = await ctx.db
        .query(rule.to)
        .withIndex(rule.via, (q: any) => q.eq(rule.field, id))
        .collect();

      for (const dep of dependents) {
        await this.collectAndDelete(ctx, rule.to, dep._id, visited, summary, rule.softDeleteField);
      }
    }

    if (softDeleteField) {
      await ctx.db.patch(id, { [softDeleteField]: Date.now() });
      summary[table] = (summary[table] || 0) + 1;
    } else if (this.deleters[table]) {
      const doc = await ctx.db.get(id);
      if (doc) {
        try {
          await this.deleters[table](ctx, id, doc);
          summary[table] = (summary[table] || 0) + 1;
        } catch {
          // Deleter failed (e.g., missing aggregate key) — fall back to raw delete
          try {
            await ctx.db.delete(id);
            summary[table] = (summary[table] || 0) + 1;
          } catch {
            // Already deleted
          }
        }
      }
    } else {
      try {
        await ctx.db.delete(id);
        summary[table] = (summary[table] || 0) + 1;
      } catch {
        // Already deleted (OCC retry or concurrent cascade)
      }
    }
  }

  /**
   * Deletes a document and its dependents across a chain of transactions.
   *
   * The root row goes first, in the calling transaction, along with as much
   * of the tree as one transaction's budget allows. If anything is left the
   * frontier is handed to the component, which schedules the batch handler;
   * every later step does the same amount of bounded work and reschedules
   * itself until the frontier is empty. Nothing ever enumerates the whole
   * tree, so there is no size at which this stops working.
   *
   * Parents are deleted before their children (pre-order). Between steps the
   * tree is therefore visible as children without a parent, never as a parent
   * with its children half gone — which is also what makes the traversal
   * cycle-safe without a visited set: a row that is already gone cannot be
   * fetched again.
   *
   * @param ctx - Mutation context
   * @param table - Source table name
   * @param id - Document ID to delete
   * @param options - Batch configuration
   * @returns Job ID (null if the cascade finished inline) and the inline step's summary
   */
  async deleteWithCascadeBatched(
    ctx: MutationCtx,
    table: string,
    id: string,
    options: {
      batchHandlerRef: FunctionReference<"mutation", FunctionVisibility>;
      /** Rows deleted per transaction. Default 500. */
      batchSize?: number;
      /** Index reads the cascade may issue per transaction. Default 1024. */
      maxReadsPerBatch?: number;
      onComplete?: FunctionReference<"mutation", FunctionVisibility>;
      onCompleteContext?: Record<string, unknown>;
    }
  ): Promise<{ jobId: string | null; initialSummary: DeletionSummary }> {
    this.assertBatchable();
    const budget: StepBudget = {
      deletes: options.batchSize ?? DEFAULT_BATCH_SIZE,
      reads: options.maxReadsPerBatch ?? DEFAULT_MAX_READS_PER_BATCH,
    };
    if (budget.deletes < 1 || budget.reads < 1) {
      throw new Error("batchSize and maxReadsPerBatch must be at least 1");
    }

    const state: StepState = {
      frontier: [],
      failedIds: new Set(),
      summary: {},
      errors: [],
    };

    // The root, pre-order: its row goes now, its dependents are the frontier.
    const rootDoc = await ctx.db.get(id);
    if (rootDoc) {
      const deleted = await this.deleteRow(ctx, table, rootDoc, state);
      if (deleted && this.hasRules(table)) {
        state.frontier.push({ table, id, ruleIndex: 0 });
      }
    }

    const { done } = await this.runStep(ctx, state, { deletes: budget.deletes, reads: budget.reads - 1 });

    const onCompleteContext = options.onCompleteContext
      ? JSON.stringify(options.onCompleteContext)
      : undefined;

    if (done) {
      if (options.onComplete) {
        const handle = await createFunctionHandle(options.onComplete);
        await ctx.scheduler.runAfter(0, handle as any, {
          summary: JSON.stringify(state.summary),
          status: state.errors.length > 0 ? "failed" : "completed",
          context: onCompleteContext,
        });
      }
      return { jobId: null, initialSummary: state.summary };
    }

    const handle = await createFunctionHandle(options.batchHandlerRef);
    const onCompleteHandle = options.onComplete
      ? await createFunctionHandle(options.onComplete)
      : undefined;

    const jobId = await ctx.runMutation(this.component.lib.createJob, {
      frontier: state.frontier,
      failedIds: [...state.failedIds],
      batchSummary: JSON.stringify(state.summary),
      errors: state.errors.length > 0 ? JSON.stringify(state.errors) : undefined,
      deleteHandleStr: handle,
      batchSize: budget.deletes,
      maxReadsPerBatch: budget.reads,
      onCompleteHandleStr: onCompleteHandle,
      onCompleteContext,
    });

    return { jobId, initialSummary: state.summary };
  }

  /**
   * One transaction's worth of a batched cascade. Exposed for the batch
   * handler; application code calls `deleteWithCascadeBatched` instead.
   *
   * Pops the deepest frontier entry, fetches one page of dependents for its
   * current rule, deletes them, pushes the ones with rules of their own, and
   * repeats until the frontier is empty or the budget is spent. Deleting on
   * fetch means the next page of the same rule is just the next `take`.
   */
  async runStep(
    ctx: MutationCtx,
    state: StepState,
    budget: StepBudget,
  ): Promise<{ done: boolean }> {
    let deletes = 0;
    let reads = 0;
    const { frontier, failedIds } = state;

    while (frontier.length > 0) {
      if (deletes >= budget.deletes || reads >= budget.reads) {
        return { done: false };
      }
      if (failedIds.size > MAX_FAILED_IDS) {
        state.errors.push(`aborted: more than ${MAX_FAILED_IDS} rows could not be deleted`);
        return { done: true };
      }
      if (frontier.length > MAX_FRONTIER) {
        state.errors.push(
          `aborted: frontier exceeded ${MAX_FRONTIER} entries — a deleter is leaving rows in place`,
        );
        return { done: true };
      }

      const top = frontier[frontier.length - 1]!;
      const rules = this.rules[top.table] ?? [];
      if (top.ruleIndex >= rules.length) {
        frontier.pop();
        continue;
      }
      const rule = rules[top.ruleIndex]!;

      const pageSize = Math.min(PAGE_SIZE, budget.deletes - deletes);
      const rows: any[] = await ctx.db
        .query(rule.to)
        .withIndex(rule.via, (q: any) => q.eq(rule.field, top.id))
        .take(pageSize + failedIds.size);
      reads++;

      const page = rows.filter((row) => !failedIds.has(row._id)).slice(0, pageSize);
      if (page.length === 0) {
        top.ruleIndex++;
        delete top.probeId;
        continue;
      }

      // The same row heading two consecutive pages means it survived its
      // deletion without the deleter throwing. Treat it as failed so the
      // page moves past it instead of refetching it forever.
      const head = page[0]!;
      if (top.probeId === head._id) {
        failedIds.add(head._id);
        state.errors.push(`${rule.to}:${head._id} - deleter returned without deleting the row`);
        continue;
      }
      top.probeId = head._id;

      const childHasRules = this.hasRules(rule.to);
      const pushed: FrontierEntry[] = [];
      for (const row of page) {
        const deleted = await this.deleteRow(ctx, rule.to, row, state);
        deletes++;
        if (deleted && childHasRules) {
          pushed.push({ table: rule.to, id: row._id, ruleIndex: 0 });
        }
      }
      // Depth first: the children just pushed are expanded (and popped)
      // before this parent's rule is fetched again.
      frontier.push(...pushed);
    }

    return { done: true };
  }

  /**
   * Deletes one fetched row through its table's deleter, falling back to a
   * raw delete. Returns false — and records the row as failed — only when
   * both refuse; the row then stays where it is and is skipped from now on.
   */
  private async deleteRow(
    ctx: MutationCtx,
    table: string,
    doc: any,
    state: StepState,
  ): Promise<boolean> {
    const id: string = doc._id;
    try {
      const deleter = this.deleters[table];
      if (deleter) {
        try {
          await deleter(ctx, id, doc);
        } catch {
          await ctx.db.delete(id);
        }
      } else {
        await ctx.db.delete(id);
      }
      state.summary[table] = (state.summary[table] ?? 0) + 1;
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      state.failedIds.add(id);
      state.errors.push(`${table}:${id} - ${message}`);
      return false;
    }
  }

  private hasRules(table: string): boolean {
    return (this.rules[table]?.length ?? 0) > 0;
  }

  /**
   * Soft-delete rules cannot be streamed: a soft-deleted row stays in the
   * index, so "fetch the next page" would fetch it again. Inline mode handles
   * them with its visited set; batched mode refuses them up front.
   */
  private assertBatchable(): void {
    for (const [source, rules] of Object.entries(this.rules)) {
      for (const rule of rules) {
        if (rule.softDeleteField) {
          throw new Error(
            `Cascade rule ${source} → ${rule.to} uses softDeleteField, which ` +
              `deleteWithCascadeBatched does not support. Use deleteWithCascade.`,
          );
        }
      }
    }
  }

  /**
   * Validates that all configured indexes exist in the database.
   * Should be called once during app initialization.
   *
   * @param ctx - Query context with db access
   * @throws Error if any index is missing or misconfigured
   */
  async validateRules(ctx: QueryCtx): Promise<void> {
    for (const [sourceTable, rules] of Object.entries(this.rules)) {
      for (const rule of rules) {
        try {
          await ctx.db
            .query(rule.to)
            .withIndex(rule.via, (q: any) => q.eq(rule.field, "__validation__"))
            .first();
        } catch {
          throw new Error(
            `Cascade validation failed: Index "${rule.via}" with field "${rule.field}" ` +
              `does not exist on table "${rule.to}". Define it in your schema. ` +
              `Source table: "${sourceTable}"`
          );
        }
      }
    }
  }

  /**
   * Cancels a running batch deletion job. The step already scheduled still
   * fires, finds the job cancelled, and stands down.
   * No-op if the job is already in a terminal state.
   *
   * @param ctx - Mutation context
   * @param jobId - Job ID returned from deleteWithCascadeBatched
   */
  async cancelBatchJob(
    ctx: MutationCtx,
    jobId: string
  ): Promise<void> {
    await ctx.runMutation(this.component.lib.cancelJob, { jobId });
  }

  /**
   * Returns a proxied database writer that blocks direct delete calls.
   * Forces use of cascade delete methods for safety.
   *
   * @param db - Original database writer
   * @returns Proxied database writer with delete disabled
   */
  patchDb(db: any): any {
    return new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "delete") {
          return (..._args: any[]) => {
            throw new Error(
              "Direct db.delete() is disabled. " +
                "Use CascadingDelete.deleteWithCascade() instead."
            );
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }
}

/**
 * Factory for the app-side step of a batched cascade. The component cannot
 * read the app's tables, so traversal runs here, in an app mutation whose
 * handle the component schedules once per step.
 *
 * @param internalMutationBuilder - The app's `internalMutation` builder. Pass
 *   the same builder every other mutation in the app uses, so any database
 *   wrapping (triggers, custom contexts) applies to cascade deletes too.
 * @param cascade - The configured `CascadingDelete` instance: its rules and
 *   deleters drive the step, its component reference stores the result.
 * @returns Internal mutation to pass as `batchHandlerRef`
 *
 * @example
 * ```typescript
 * export const _cascadeBatchHandler = makeBatchDeleteHandler(internalMutation, cd);
 * ```
 */
export function makeBatchDeleteHandler(
  internalMutationBuilder: any,
  cascade: CascadingDelete,
) {
  return internalMutationBuilder({
    args: { jobId: v.string() },
    returns: v.null(),
    handler: async (ctx: any, { jobId }: { jobId: string }) => {
      const job = await ctx.runQuery(cascade.component.lib.loadJob, { jobId });
      if (!job) return null; // cancelled, finalized, or gone

      const state: StepState = {
        frontier: job.frontier,
        failedIds: new Set(job.failedIds),
        summary: {},
        errors: [],
      };
      const { done } = await cascade.runStep(ctx, state, {
        deletes: job.batchSize,
        reads: job.maxReadsPerBatch,
      });

      await ctx.runMutation(cascade.component.lib.saveStep, {
        jobId,
        frontier: state.frontier,
        failedIds: [...state.failedIds],
        batchSummary: JSON.stringify(state.summary),
        errors: state.errors.length > 0 ? JSON.stringify(state.errors) : undefined,
        done,
      });
      return null;
    },
  });
}
