/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as breadcrumb from "../breadcrumb.js";
import type * as callSessions from "../callSessions.js";
import type * as channelMembers from "../channelMembers.js";
import type * as channels from "../channels.js";
import type * as chatNotifications from "../chatNotifications.js";
import type * as collaboration from "../collaboration.js";
import type * as diagrams from "../diagrams.js";
import type * as documents from "../documents.js";
import type * as emails from "../emails.js";
import type * as http from "../http.js";
import type * as medias from "../medias.js";
import type * as messageReactions from "../messageReactions.js";
import type * as messages from "../messages.js";
import type * as migrations from "../migrations.js";
import type * as projects from "../projects.js";
import type * as pushNotifications from "../pushNotifications.js";
import type * as pushSubscription from "../pushSubscription.js";
import type * as snapshots from "../snapshots.js";
import type * as spreadsheetCellRefs from "../spreadsheetCellRefs.js";
import type * as spreadsheetCellRefsNode from "../spreadsheetCellRefsNode.js";
import type * as spreadsheets from "../spreadsheets.js";
import type * as taskComments from "../taskComments.js";
import type * as taskNotifications from "../taskNotifications.js";
import type * as taskStatuses from "../taskStatuses.js";
import type * as tasks from "../tasks.js";
import type * as users from "../users.js";
import type * as utils_blocknote from "../utils/blocknote.js";
import type * as workspaceInvites from "../workspaceInvites.js";
import type * as workspaceMembers from "../workspaceMembers.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  breadcrumb: typeof breadcrumb;
  callSessions: typeof callSessions;
  channelMembers: typeof channelMembers;
  channels: typeof channels;
  chatNotifications: typeof chatNotifications;
  collaboration: typeof collaboration;
  diagrams: typeof diagrams;
  documents: typeof documents;
  emails: typeof emails;
  http: typeof http;
  medias: typeof medias;
  messageReactions: typeof messageReactions;
  messages: typeof messages;
  migrations: typeof migrations;
  projects: typeof projects;
  pushNotifications: typeof pushNotifications;
  pushSubscription: typeof pushSubscription;
  snapshots: typeof snapshots;
  spreadsheetCellRefs: typeof spreadsheetCellRefs;
  spreadsheetCellRefsNode: typeof spreadsheetCellRefsNode;
  spreadsheets: typeof spreadsheets;
  taskComments: typeof taskComments;
  taskNotifications: typeof taskNotifications;
  taskStatuses: typeof taskStatuses;
  tasks: typeof tasks;
  users: typeof users;
  "utils/blocknote": typeof utils_blocknote;
  workspaceInvites: typeof workspaceInvites;
  workspaceMembers: typeof workspaceMembers;
  workspaces: typeof workspaces;
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
  migrations: {
    lib: {
      cancel: FunctionReference<
        "mutation",
        "internal",
        { name: string },
        {
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }
      >;
      cancelAll: FunctionReference<
        "mutation",
        "internal",
        { sinceTs?: number },
        Array<{
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }>
      >;
      clearAll: FunctionReference<
        "mutation",
        "internal",
        { before?: number },
        null
      >;
      getStatus: FunctionReference<
        "query",
        "internal",
        { limit?: number; names?: Array<string> },
        Array<{
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }>
      >;
      migrate: FunctionReference<
        "mutation",
        "internal",
        {
          batchSize?: number;
          cursor?: string | null;
          dryRun: boolean;
          fnHandle: string;
          name: string;
          next?: Array<{ fnHandle: string; name: string }>;
          oneBatchOnly?: boolean;
        },
        {
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }
      >;
    };
  };
};
