/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";
import type { GenericId as Id } from "convex/values";
import { anyApi, componentsGeneric } from "convex/server";

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: {
  lib: {
    batchSetScope: FunctionReference<
      "mutation",
      "public",
      { patches: Array<{ id: Id<"auditLogs">; scope: string }> },
      number
    >;
    cleanup: FunctionReference<
      "mutation",
      "public",
      {
        batchSize?: number;
        olderThanDays?: number;
        preserveSeverity?: Array<"info" | "warning" | "error" | "critical">;
        retentionCategory?: string;
      },
      number
    >;
    detectAnomalies: FunctionReference<
      "query",
      "public",
      {
        patterns: Array<{
          action: string;
          threshold: number;
          windowMinutes: number;
        }>;
      },
      Array<{
        action: string;
        count: number;
        detectedAt: number;
        threshold: number;
        windowMinutes: number;
      }>
    >;
    generateReport: FunctionReference<
      "query",
      "public",
      {
        endDate: number;
        format: "json" | "csv";
        groupBy?: string;
        includeFields?: Array<string>;
        maxRecords?: number;
        startDate: number;
      },
      {
        data: string;
        format: "json" | "csv";
        generatedAt: number;
        recordCount: number;
        truncated: boolean;
      }
    >;
    get: FunctionReference<
      "query",
      "public",
      { id: string },
      null | {
        _creationTime: number;
        _id: Id<"auditLogs">;
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
      }
    >;
    getConfig: FunctionReference<
      "query",
      "public",
      {},
      null | {
        _creationTime: number;
        _id: Id<"config">;
        criticalRetentionDays: number;
        customRetention?: Array<{ category: string; retentionDays: number }>;
        defaultRetentionDays: number;
        piiFieldsToRedact: Array<string>;
        samplingEnabled: boolean;
        samplingRate: number;
      }
    >;
    getStats: FunctionReference<
      "query",
      "public",
      { fromTimestamp?: number; toTimestamp?: number },
      {
        bySeverity: {
          critical: number;
          error: number;
          info: number;
          warning: number;
        };
        topActions: Array<{ action: string; count: number }>;
        topActors: Array<{ actorId: string; count: number }>;
        totalCount: number;
      }
    >;
    log: FunctionReference<
      "mutation",
      "public",
      {
        action: string;
        actorId?: string;
        ipAddress?: string;
        metadata?: any;
        resourceId?: string;
        resourceType?: string;
        retentionCategory?: string;
        scope?: string;
        sessionId?: string;
        severity: "info" | "warning" | "error" | "critical";
        tags?: Array<string>;
        userAgent?: string;
      },
      Id<"auditLogs">
    >;
    logBulk: FunctionReference<
      "mutation",
      "public",
      {
        events: Array<{
          action: string;
          actorId?: string;
          ipAddress?: string;
          metadata?: any;
          resourceId?: string;
          resourceType?: string;
          retentionCategory?: string;
          scope?: string;
          sessionId?: string;
          severity: "info" | "warning" | "error" | "critical";
          tags?: Array<string>;
          userAgent?: string;
        }>;
      },
      Array<Id<"auditLogs">>
    >;
    logChange: FunctionReference<
      "mutation",
      "public",
      {
        action: string;
        actorId?: string;
        after?: any;
        before?: any;
        generateDiff?: boolean;
        ipAddress?: string;
        resourceId: string;
        resourceType: string;
        retentionCategory?: string;
        scope?: string;
        sessionId?: string;
        severity?: "info" | "warning" | "error" | "critical";
        tags?: Array<string>;
        userAgent?: string;
      },
      Id<"auditLogs">
    >;
    migrateActionPrefix: FunctionReference<
      "mutation",
      "public",
      {
        batchSize?: number;
        cursor?: string;
        newPrefix: string;
        oldPrefix: string;
      },
      {
        cursor: string | null;
        isDone: boolean;
        migrated: number;
        scanned: number;
      }
    >;
    queryByAction: FunctionReference<
      "query",
      "public",
      { action: string; fromTimestamp?: number; limit?: number },
      Array<{
        _creationTime: number;
        _id: Id<"auditLogs">;
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
      }>
    >;
    queryByActionResource: FunctionReference<
      "query",
      "public",
      {
        action: string;
        fromTimestamp?: number;
        limit?: number;
        resourceId: string;
      },
      Array<{
        _creationTime: number;
        _id: Id<"auditLogs">;
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
      }>
    >;
    queryByActor: FunctionReference<
      "query",
      "public",
      {
        actions?: Array<string>;
        actorId: string;
        fromTimestamp?: number;
        limit?: number;
      },
      Array<{
        _creationTime: number;
        _id: Id<"auditLogs">;
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
      }>
    >;
    queryByResource: FunctionReference<
      "query",
      "public",
      {
        fromTimestamp?: number;
        limit?: number;
        resourceId: string;
        resourceType: string;
      },
      Array<{
        _creationTime: number;
        _id: Id<"auditLogs">;
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
      }>
    >;
    queryByScope: FunctionReference<
      "query",
      "public",
      {
        fromTimestamp?: number;
        limit?: number;
        resourceTypes?: Array<string>;
        scope: string;
      },
      Array<{
        _creationTime: number;
        _id: Id<"auditLogs">;
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
      }>
    >;
    queryBySeverity: FunctionReference<
      "query",
      "public",
      {
        fromTimestamp?: number;
        limit?: number;
        severity: Array<"info" | "warning" | "error" | "critical">;
      },
      Array<{
        _creationTime: number;
        _id: Id<"auditLogs">;
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
      }>
    >;
    runBackfill: FunctionReference<
      "mutation",
      "public",
      { batchSize?: number; cursor?: string },
      { cursor: string | null; isDone: boolean; processed: number }
    >;
    scanWithoutScope: FunctionReference<
      "query",
      "public",
      { batchSize?: number; cursor?: string },
      {
        cursor: string | null;
        isDone: boolean;
        items: Array<{
          _id: Id<"auditLogs">;
          resourceId?: string;
          resourceType?: string;
        }>;
      }
    >;
    search: FunctionReference<
      "query",
      "public",
      {
        filters: {
          actions?: Array<string>;
          actorIds?: Array<string>;
          fromTimestamp?: number;
          resourceTypes?: Array<string>;
          scope?: string;
          severity?: Array<"info" | "warning" | "error" | "critical">;
          tags?: Array<string>;
          toTimestamp?: number;
        };
        pagination: { cursor?: string; limit: number };
      },
      {
        cursor: string | null;
        hasMore: boolean;
        items: Array<{
          _creationTime: number;
          _id: Id<"auditLogs">;
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
        }>;
      }
    >;
    updateConfig: FunctionReference<
      "mutation",
      "public",
      {
        criticalRetentionDays?: number;
        customRetention?: Array<{ category: string; retentionDays: number }>;
        defaultRetentionDays?: number;
        piiFieldsToRedact?: Array<string>;
        samplingEnabled?: boolean;
        samplingRate?: number;
      },
      Id<"config">
    >;
    watchCritical: FunctionReference<
      "query",
      "public",
      {
        limit?: number;
        severity?: Array<"info" | "warning" | "error" | "critical">;
      },
      Array<{
        _creationTime: number;
        _id: Id<"auditLogs">;
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
      }>
    >;
  };
} = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: {
  lib: {
    _updateAggregates: FunctionReference<
      "mutation",
      "internal",
      { docId: Id<"auditLogs"> },
      null
    >;
    _updateAggregatesBatch: FunctionReference<
      "mutation",
      "internal",
      { docIds: Array<Id<"auditLogs">> },
      null
    >;
  };
} = anyApi as any;

export const components = componentsGeneric() as unknown as {
  aggregateBySeverity: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"aggregateBySeverity">;
  aggregateByAction: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"aggregateByAction">;
};
