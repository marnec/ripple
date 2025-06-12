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
import type * as channelMembers from "../channelMembers.js";
import type * as channels from "../channels.js";
import type * as diagrams from "../diagrams.js";
import type * as documents from "../documents.js";
import type * as emails from "../emails.js";
import type * as http from "../http.js";
import type * as messages from "../messages.js";
import type * as prosemirror from "../prosemirror.js";
import type * as pushNotifications from "../pushNotifications.js";
import type * as pushSubscription from "../pushSubscription.js";
import type * as signaling from "../signaling.js";
import type * as users from "../users.js";
import type * as workspaceInvites from "../workspaceInvites.js";
import type * as workspaceMembers from "../workspaceMembers.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  breadcrumb: typeof breadcrumb;
  channelMembers: typeof channelMembers;
  channels: typeof channels;
  diagrams: typeof diagrams;
  documents: typeof documents;
  emails: typeof emails;
  http: typeof http;
  messages: typeof messages;
  prosemirror: typeof prosemirror;
  pushNotifications: typeof pushNotifications;
  pushSubscription: typeof pushSubscription;
  signaling: typeof signaling;
  users: typeof users;
  workspaceInvites: typeof workspaceInvites;
  workspaceMembers: typeof workspaceMembers;
  workspaces: typeof workspaces;
}>;
declare const fullApiWithMounts: typeof fullApi;

export declare const api: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "internal">
>;

export declare const components: {
  prosemirrorSync: {
    lib: {
      deleteDocument: FunctionReference<
        "mutation",
        "internal",
        { id: string },
        null
      >;
      deleteSnapshots: FunctionReference<
        "mutation",
        "internal",
        { afterVersion?: number; beforeVersion?: number; id: string },
        null
      >;
      deleteSteps: FunctionReference<
        "mutation",
        "internal",
        {
          afterVersion?: number;
          beforeTs: number;
          deleteNewerThanLatestSnapshot?: boolean;
          id: string;
        },
        null
      >;
      getSnapshot: FunctionReference<
        "query",
        "internal",
        { id: string; version?: number },
        { content: null } | { content: string; version: number }
      >;
      getSteps: FunctionReference<
        "query",
        "internal",
        { id: string; version: number },
        {
          clientIds: Array<string | number>;
          steps: Array<string>;
          version: number;
        }
      >;
      latestVersion: FunctionReference<
        "query",
        "internal",
        { id: string },
        null | number
      >;
      submitSnapshot: FunctionReference<
        "mutation",
        "internal",
        {
          content: string;
          id: string;
          pruneSnapshots?: boolean;
          version: number;
        },
        null
      >;
      submitSteps: FunctionReference<
        "mutation",
        "internal",
        {
          clientId: string | number;
          id: string;
          steps: Array<string>;
          version: number;
        },
        | {
            clientIds: Array<string | number>;
            status: "needs-rebase";
            steps: Array<string>;
          }
        | { status: "synced" }
      >;
    };
  };
};
