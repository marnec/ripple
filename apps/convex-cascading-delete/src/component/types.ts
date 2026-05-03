/*
(1.) Core type definitions for cascade delete configuration and operations
(2.) Establishes the contract between component and consuming applications
(3.) Provides type safety for relationship declarations and deletion operations

This module defines the fundamental types used throughout the cascading delete
component. The CascadeRule type represents a single relationship between tables,
specifying the target table, the index to traverse, and the field name used in
the index equality condition. The CascadeConfig type maps source tables to their
cascade rules, forming a complete deletion graph. These types ensure compile-time
safety and enable proper TypeScript inference across the component boundary while
maintaining flexibility for various schema structures and relationship patterns.
*/

/**
 * Represents a single cascade relationship from one table to another.
 * 
 * @property to - The target table name where related documents exist
 * @property via - The index name on the target table used to find related documents
 * @property field - The field name in the index used for equality matching
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
 * Internal representation of a document to be deleted.
 * Tracks the table name and document ID for deletion operations.
 */
export type DeletionTarget = {
  table: string;
  id: string;
};

/**
 * Status information for a batch deletion job.
 * Provides progress tracking and completion details.
 */
export type BatchJobStatus = {
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  totalTargetCount: number;
  completedCount: number;
  completedSummary: DeletionSummary;
  error?: string;
};
