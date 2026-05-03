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
    createBatchJob: FunctionReference<
      "mutation",
      "public",
      {
        batchSize: number;
        deleteHandleStr: string;
        onCompleteContext?: string;
        onCompleteHandleStr?: string;
        targets: Array<{ id: string; table: string }>;
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
        status: "pending" | "processing" | "completed" | "failed" | "cancelled";
        totalTargetCount: number;
      } | null
    >;
    reportBatchComplete: FunctionReference<
      "mutation",
      "public",
      { batchSummary: string; errors?: string; jobId: string },
      null
    >;
    startProcessing: FunctionReference<
      "mutation",
      "public",
      { jobId: string },
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
export const internal: {
  lib: {
    deletionWorkflow: FunctionReference<"mutation", "internal", any, any>;
    dispatchNextChunk: FunctionReference<
      "mutation",
      "internal",
      { jobId: string },
      { hasMore: boolean }
    >;
    markAllDispatched: FunctionReference<
      "mutation",
      "internal",
      { jobId: string },
      null
    >;
  };
} = anyApi as any;

export const components = componentsGeneric() as unknown as {
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
};
