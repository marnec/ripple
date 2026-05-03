/* eslint-disable */
/**
 * Generated data model types.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  DocumentByName,
  TableNamesInDataModel,
  SystemTableNames,
  AnyDataModel,
} from "convex/server";
import type { GenericId } from "convex/values";

/**
 * A type describing your Convex data model.
 *
 * This type includes information about what tables you have, the type of
 * documents stored in those tables, and the indexes defined on them.
 *
 * This type is used to parameterize methods like `queryGeneric` and
 * `mutationGeneric` to make them type-safe.
 */

export type DataModel = {
  deletionJobs: {
    document: {
      batchSize: number;
      completedCount: number;
      completedSummary: string;
      deleteHandleStr: string;
      dispatchedChunkCount: number;
      error?: string;
      onCompleteContext?: string;
      onCompleteHandleStr?: string;
      status: "pending" | "processing" | "completed" | "failed" | "cancelled";
      totalChunkCount: number;
      totalTargetCount: number;
      workflowId?: string;
      _id: Id<"deletionJobs">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "batchSize"
      | "completedCount"
      | "completedSummary"
      | "deleteHandleStr"
      | "dispatchedChunkCount"
      | "error"
      | "onCompleteContext"
      | "onCompleteHandleStr"
      | "status"
      | "totalChunkCount"
      | "totalTargetCount"
      | "workflowId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      byStatus: ["status", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  deletionTargetChunks: {
    document: {
      chunkIndex: number;
      jobId: Id<"deletionJobs">;
      targets: Array<{ id: string; table: string }>;
      _id: Id<"deletionTargetChunks">;
      _creationTime: number;
    };
    fieldPaths: "_creationTime" | "_id" | "chunkIndex" | "jobId" | "targets";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_job_chunk: ["jobId", "chunkIndex", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
};

/**
 * The names of all of your Convex tables.
 */
export type TableNames = TableNamesInDataModel<DataModel>;

/**
 * The type of a document stored in Convex.
 *
 * @typeParam TableName - A string literal type of the table name (like "users").
 */
export type Doc<TableName extends TableNames> = DocumentByName<
  DataModel,
  TableName
>;

/**
 * An identifier for a document in Convex.
 *
 * Convex documents are uniquely identified by their `Id`, which is accessible
 * on the `_id` field. To learn more, see [Document IDs](https://docs.convex.dev/using/document-ids).
 *
 * Documents can be loaded using `db.get(tableName, id)` in query and mutation functions.
 *
 * IDs are just strings at runtime, but this type can be used to distinguish them from other
 * strings when type checking.
 *
 * @typeParam TableName - A string literal type of the table name (like "users").
 */
export type Id<TableName extends TableNames | SystemTableNames> =
  GenericId<TableName>;
