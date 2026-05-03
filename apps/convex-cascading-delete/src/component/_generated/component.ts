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
      createBatchJob: FunctionReference<
        "mutation",
        "internal",
        {
          batchSize: number;
          deleteHandleStr: string;
          onCompleteContext?: string;
          onCompleteHandleStr?: string;
          targets: Array<{ id: string; table: string }>;
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
          status:
            | "pending"
            | "processing"
            | "completed"
            | "failed"
            | "cancelled";
          totalTargetCount: number;
        } | null,
        Name
      >;
      reportBatchComplete: FunctionReference<
        "mutation",
        "internal",
        { batchSummary: string; errors?: string; jobId: string },
        null,
        Name
      >;
      startProcessing: FunctionReference<
        "mutation",
        "internal",
        { jobId: string },
        null,
        Name
      >;
    };
  };
