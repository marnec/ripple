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
    cancelJob: FunctionReference<"mutation", "public", { jobId: string }, null>;
    createJob: FunctionReference<
      "mutation",
      "public",
      {
        batchSize: number;
        batchSummary: string;
        deleteHandleStr: string;
        errors?: string;
        failedIds: Array<string>;
        frontier: Array<{
          id: string;
          probeId?: string;
          ruleIndex: number;
          table: string;
        }>;
        maxReadsPerBatch: number;
        onCompleteContext?: string;
        onCompleteHandleStr?: string;
      },
      string
    >;
    getJobStatus: FunctionReference<
      "query",
      "public",
      { jobId: string },
      {
        completedCount: number;
        completedSummary: string;
        error?: string;
        pendingCount: number;
        status: "processing" | "completed" | "failed" | "cancelled";
        stepCount: number;
      } | null
    >;
    loadJob: FunctionReference<
      "query",
      "public",
      { jobId: string },
      {
        batchSize: number;
        failedIds: Array<string>;
        frontier: Array<{
          id: string;
          probeId?: string;
          ruleIndex: number;
          table: string;
        }>;
        maxReadsPerBatch: number;
      } | null
    >;
    saveStep: FunctionReference<
      "mutation",
      "public",
      {
        batchSummary: string;
        done: boolean;
        errors?: string;
        failedIds: Array<string>;
        frontier: Array<{
          id: string;
          probeId?: string;
          ruleIndex: number;
          table: string;
        }>;
        jobId: string;
      },
      null
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
export const internal: {} = anyApi as any;

export const components = componentsGeneric() as unknown as {};
