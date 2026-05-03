/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as cascading from "../cascading.js";
import type * as deletions from "../deletions.js";
import type * as http from "../http.js";
import type * as orgTree from "../orgTree.js";
import type * as queries from "../queries.js";
import type * as seed from "../seed.js";
import type * as seedLarge from "../seedLarge.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  cascading: typeof cascading;
  deletions: typeof deletions;
  http: typeof http;
  orgTree: typeof orgTree;
  queries: typeof queries;
  seed: typeof seed;
  seedLarge: typeof seedLarge;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  convexCascadingDelete: import("@00akshatsinha00/convex-cascading-delete/_generated/component.js").ComponentApi<"convexCascadingDelete">;
};
