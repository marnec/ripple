/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as auth from "../auth.js";
import type * as channels from "../channels.js";
import type * as emails from "../emails.js";
import type * as http from "../http.js";
import type * as messages from "../messages.js";
import type * as otp from "../otp.js";
import type * as passwordReset from "../passwordReset.js";
import type * as users from "../users.js";
import type * as workspaceInvites from "../workspaceInvites.js";
import type * as workspaces from "../workspaces.js";

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
  channels: typeof channels;
  emails: typeof emails;
  http: typeof http;
  messages: typeof messages;
  otp: typeof otp;
  passwordReset: typeof passwordReset;
  users: typeof users;
  workspaceInvites: typeof workspaceInvites;
  workspaces: typeof workspaces;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
