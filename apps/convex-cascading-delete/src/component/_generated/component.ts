/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    lib: {
      cancelJob: FunctionReference<
        "mutation",
        "internal",
        { jobId: string },
        null,
        Name
      >;
      createJob: FunctionReference<
        "mutation",
        "internal",
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
        string,
        Name
      >;
      getJobStatus: FunctionReference<
        "query",
        "internal",
        { jobId: string },
        {
          completedCount: number;
          completedSummary: string;
          error?: string;
          pendingCount: number;
          status: "processing" | "completed" | "failed" | "cancelled";
          stepCount: number;
        } | null,
        Name
      >;
      loadJob: FunctionReference<
        "query",
        "internal",
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
        } | null,
        Name
      >;
      saveStep: FunctionReference<
        "mutation",
        "internal",
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
        null,
        Name
      >;
    };
  };
