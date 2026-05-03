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
  auditLogs: {
    document: {
      action: string;
      actorId?: string;
      after?: any;
      before?: any;
      diff?: string;
      ipAddress?: string;
      metadata?: any;
      resourceId?: string;
      resourceType?: string;
      retentionCategory?: string;
      scope?: string;
      sessionId?: string;
      severity: "info" | "warning" | "error" | "critical";
      tags?: Array<string>;
      timestamp: number;
      userAgent?: string;
      _id: Id<"auditLogs">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "action"
      | "actorId"
      | "after"
      | "before"
      | "diff"
      | "ipAddress"
      | "metadata"
      | "resourceId"
      | "resourceType"
      | "retentionCategory"
      | "scope"
      | "sessionId"
      | "severity"
      | "tags"
      | "timestamp"
      | "userAgent";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_action_resource: [
        "action",
        "resourceId",
        "timestamp",
        "_creationTime",
      ];
      by_action_timestamp: ["action", "timestamp", "_creationTime"];
      by_actor_timestamp: ["actorId", "timestamp", "_creationTime"];
      by_resource: ["resourceType", "resourceId", "timestamp", "_creationTime"];
      by_retention_timestamp: [
        "retentionCategory",
        "timestamp",
        "_creationTime",
      ];
      by_scope_resourceType_timestamp: [
        "scope",
        "resourceType",
        "timestamp",
        "_creationTime",
      ];
      by_scope_timestamp: ["scope", "timestamp", "_creationTime"];
      by_severity_timestamp: ["severity", "timestamp", "_creationTime"];
      by_timestamp: ["timestamp", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  config: {
    document: {
      criticalRetentionDays: number;
      customRetention?: Array<{ category: string; retentionDays: number }>;
      defaultRetentionDays: number;
      piiFieldsToRedact: Array<string>;
      samplingEnabled: boolean;
      samplingRate: number;
      _id: Id<"config">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "criticalRetentionDays"
      | "customRetention"
      | "defaultRetentionDays"
      | "piiFieldsToRedact"
      | "samplingEnabled"
      | "samplingRate";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
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
