/*
(1.) Core type definitions for cascade delete configuration and operations
(2.) Establishes the contract between component and consuming applications
(3.) Provides type safety for relationship declarations and deletion operations

This module defines the fundamental types used throughout the cascading delete
component. The CascadeRule type represents a single relationship between tables,
specifying the target table, the index to traverse, and the field name used in
the index equality condition. The CascadeConfig type maps source tables to their
cascade rules, forming a complete deletion graph. The FrontierEntry type is the
unit of persisted state for a batched cascade: a parent whose row is already
gone and whose dependents are still being enumerated.
*/

/**
 * Represents a single cascade relationship from one table to another.
 *
 * @property to - The target table name where related documents exist
 * @property via - The index name on the target table used to find related documents
 * @property field - The field name in the index used for equality matching
 * @property softDeleteField - Inline mode only: patch this field with a
 *   timestamp instead of deleting the dependent. Batched mode rejects rules
 *   that set it (see `deleteWithCascadeBatched`).
 *
 * @example
 * { to: "posts", via: "by_author", field: "authorId" }
 * // When deleting a user, find posts using: .withIndex("by_author", q => q.eq("authorId", userId))
 */
export type CascadeRule = {
  to: string;
  via: string;
  field: string;
  softDeleteField?: string;
};

/**
 * Custom deletion function for a specific table.
 * Called instead of ctx.db.delete() when registered via the deleters option.
 */
export type TableDeleter = (ctx: any, id: string, doc: any) => Promise<void>;

/**
 * Complete cascade configuration mapping source tables to their cascade rules.
 *
 * @example
 * {
 *   users: [
 *     { to: "posts", via: "by_author", field: "authorId" },
 *     { to: "comments", via: "by_author", field: "authorId" }
 *   ],
 *   posts: [
 *     { to: "comments", via: "by_post", field: "postId" }
 *   ]
 * }
 */
export interface CascadeConfig {
  [sourceTable: string]: CascadeRule[];
}

/**
 * Summary of documents deleted during a cascade operation.
 * Maps table names to the count of documents deleted from each table.
 *
 * @example
 * { users: 1, posts: 5, comments: 23, likes: 47 }
 */
export type DeletionSummary = {
  [tableName: string]: number;
};

/**
 * A parent still being expanded by a batched cascade. Its own row was deleted
 * the moment it was fetched; what remains is enumerating its dependents, rule
 * by rule. `ruleIndex` is the rule currently being drained — every rule before
 * it has already returned an empty page. `probeId` is the first row the last
 * page of that rule returned; seeing it again means the deleter left the row
 * in place, which would otherwise loop forever.
 */
export type FrontierEntry = {
  table: string;
  id: string;
  ruleIndex: number;
  probeId?: string;
};

/**
 * Per-transaction budget for one step of a batched cascade. A step stops as
 * soon as either counter is spent and hands the frontier to the next one.
 *
 * @property deletes - rows deleted (or attempted) in this transaction
 * @property reads - index range reads (`db.query` / `db.get`) issued by the
 *   cascade itself. Deleters and triggers spend the same Convex budget, so
 *   leave headroom for them.
 */
export type StepBudget = {
  deletes: number;
  reads: number;
};

/**
 * Status information for a batched cascade job.
 *
 * `pendingCount` is the size of the frontier: parents whose rows are gone but
 * whose dependents are still being enumerated. The total is unknowable up
 * front — the tree is discovered as it is deleted — so there is no
 * "total targets" figure to compute a percentage from.
 */
export type BatchJobStatus = {
  status: "processing" | "completed" | "failed" | "cancelled";
  completedCount: number;
  pendingCount: number;
  stepCount: number;
  completedSummary: string;
  error?: string;
};
