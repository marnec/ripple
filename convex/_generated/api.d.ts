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

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: {
  auth: {
    signIn: FunctionReference<
      "action",
      "public",
      {
        calledBy?: string;
        params?: any;
        provider?: string;
        refreshToken?: string;
        verifier?: string;
      },
      any
    >;
    signOut: FunctionReference<"action", "public", {}, any>;
  };
  breadcrumb: {
    getResourceName: FunctionReference<
      "query",
      "public",
      {
        resourceId:
          | Id<"workspaces">
          | Id<"channels">
          | Id<"projects">
          | Id<"documents">
          | Id<"diagrams">
          | Id<"spreadsheets">
          | Id<"tasks">;
      },
      any
    >;
  };
  callSessions: {
    endSession: FunctionReference<
      "mutation",
      "public",
      { channelId: Id<"channels"> },
      null
    >;
    joinCall: FunctionReference<
      "action",
      "public",
      { channelId: Id<"channels">; userImage?: string; userName: string },
      { authToken: string; meetingId: string }
    >;
  };
  channelMembers: {
    addToChannel: FunctionReference<
      "mutation",
      "public",
      { channelId: Id<"channels">; userId: Id<"users"> },
      Id<"channelMembers">
    >;
    byChannel: FunctionReference<
      "query",
      "public",
      { channelId: Id<"channels"> },
      Array<{
        _creationTime: number;
        _id: Id<"channelMembers">;
        channelId: Id<"channels">;
        role: "admin" | "member";
        userId: Id<"users">;
        workspaceId: Id<"workspaces">;
      }>
    >;
    changeMemberRole: FunctionReference<
      "mutation",
      "public",
      { channelMemberId: Id<"channelMembers">; role: "admin" | "member" },
      null
    >;
    membersByChannel: FunctionReference<
      "query",
      "public",
      { channelId: Id<"channels"> },
      Array<{
        _creationTime: number;
        _id: Id<"channelMembers">;
        channelId: Id<"channels">;
        name: string;
        role: "admin" | "member";
        userId: Id<"users">;
        workspaceId: Id<"workspaces">;
      }>
    >;
    removeFromChannel: FunctionReference<
      "mutation",
      "public",
      { channelId: Id<"channels">; userId: Id<"users"> },
      null
    >;
  };
  channels: {
    create: FunctionReference<
      "mutation",
      "public",
      { isPublic: boolean; name: string; workspaceId: Id<"workspaces"> },
      Id<"channels">
    >;
    get: FunctionReference<
      "query",
      "public",
      { id: Id<"channels"> },
      {
        _creationTime: number;
        _id: Id<"channels">;
        isPublic: boolean;
        name: string;
        roleCount: { admin: number; member: number };
        workspaceId: Id<"workspaces">;
      } | null
    >;
    list: FunctionReference<
      "query",
      "public",
      { workspaceId: Id<"workspaces"> },
      Array<{
        _creationTime: number;
        _id: Id<"channels">;
        isPublic: boolean;
        name: string;
        roleCount: { admin: number; member: number };
        workspaceId: Id<"workspaces">;
      }>
    >;
    listByUserMembership: FunctionReference<
      "query",
      "public",
      { workspaceId: Id<"workspaces"> },
      Array<{
        _creationTime: number;
        _id: Id<"channels">;
        isPublic: boolean;
        name: string;
        roleCount: { admin: number; member: number };
        workspaceId: Id<"workspaces">;
      }>
    >;
    remove: FunctionReference<
      "mutation",
      "public",
      { id: Id<"channels"> },
      null
    >;
    search: FunctionReference<
      "query",
      "public",
      { searchText?: string; workspaceId: Id<"workspaces"> },
      any
    >;
    update: FunctionReference<
      "mutation",
      "public",
      { id: Id<"channels">; name?: string },
      null
    >;
  };
  collaboration: {
    getCollaborationToken: FunctionReference<
      "action",
      "public",
      {
        resourceId: string;
        resourceType: "doc" | "diagram" | "task" | "presence" | "spreadsheet";
      },
      { roomId: string; token: string }
    >;
  };
  contentReferences: {
    getReferencesTo: FunctionReference<
      "query",
      "public",
      { targetId: string },
      any
    >;
    syncReferences: FunctionReference<
      "mutation",
      "public",
      {
        references: Array<{
          targetId: string;
          targetType: "diagram" | "spreadsheet";
        }>;
        sourceId: string;
        sourceType: "document" | "task";
        workspaceId: Id<"workspaces">;
      },
      null
    >;
  };
  diagrams: {
    create: FunctionReference<
      "mutation",
      "public",
      { name?: string; workspaceId: Id<"workspaces"> },
      Id<"diagrams">
    >;
    get: FunctionReference<
      "query",
      "public",
      { id: Id<"diagrams"> },
      {
        _creationTime: number;
        _id: Id<"diagrams">;
        name: string;
        tags?: Array<string>;
        workspaceId: Id<"workspaces">;
        yjsSnapshotId?: Id<"_storage">;
      } | null
    >;
    list: FunctionReference<
      "query",
      "public",
      { workspaceId: Id<"workspaces"> },
      Array<{
        _creationTime: number;
        _id: Id<"diagrams">;
        name: string;
        tags?: Array<string>;
        workspaceId: Id<"workspaces">;
        yjsSnapshotId?: Id<"_storage">;
      }>
    >;
    remove: FunctionReference<
      "mutation",
      "public",
      { force?: boolean; id: Id<"diagrams"> },
      any
    >;
    rename: FunctionReference<
      "mutation",
      "public",
      { id: Id<"diagrams">; name: string },
      null
    >;
    search: FunctionReference<
      "query",
      "public",
      {
        isFavorite?: boolean;
        searchText?: string;
        tags?: Array<string>;
        workspaceId: Id<"workspaces">;
      },
      any
    >;
    updateTags: FunctionReference<
      "mutation",
      "public",
      { id: Id<"diagrams">; tags: Array<string> },
      null
    >;
  };
  documents: {
    create: FunctionReference<
      "mutation",
      "public",
      { workspaceId: Id<"workspaces"> },
      Id<"documents">
    >;
    get: FunctionReference<
      "query",
      "public",
      { id: Id<"documents"> },
      {
        _creationTime: number;
        _id: Id<"documents">;
        name: string;
        tags?: Array<string>;
        workspaceId: Id<"workspaces">;
        yjsSnapshotId?: Id<"_storage">;
      } | null
    >;
    list: FunctionReference<
      "query",
      "public",
      { workspaceId: Id<"workspaces"> },
      Array<{
        _creationTime: number;
        _id: Id<"documents">;
        name: string;
        tags?: Array<string>;
        workspaceId: Id<"workspaces">;
        yjsSnapshotId?: Id<"_storage">;
      }>
    >;
    remove: FunctionReference<
      "mutation",
      "public",
      { id: Id<"documents"> },
      null
    >;
    rename: FunctionReference<
      "mutation",
      "public",
      { id: Id<"documents">; name: string },
      null
    >;
    search: FunctionReference<
      "query",
      "public",
      {
        isFavorite?: boolean;
        searchText?: string;
        tags?: Array<string>;
        workspaceId: Id<"workspaces">;
      },
      any
    >;
    updateTags: FunctionReference<
      "mutation",
      "public",
      { id: Id<"documents">; tags: Array<string> },
      null
    >;
  };
  favorites: {
    isFavorited: FunctionReference<
      "query",
      "public",
      { resourceId: string },
      boolean
    >;
    listByType: FunctionReference<
      "query",
      "public",
      {
        paginationOpts: {
          cursor: string | null;
          endCursor?: string | null;
          id?: number;
          maximumBytesRead?: number;
          maximumRowsRead?: number;
          numItems: number;
        };
        resourceType: "document" | "diagram" | "spreadsheet" | "project";
        workspaceId: Id<"workspaces">;
      },
      any
    >;
    listIdsForType: FunctionReference<
      "query",
      "public",
      {
        resourceType: "document" | "diagram" | "spreadsheet" | "project";
        workspaceId: Id<"workspaces">;
      },
      Array<string>
    >;
    listPinned: FunctionReference<
      "query",
      "public",
      { workspaceId: Id<"workspaces"> },
      any
    >;
    toggle: FunctionReference<
      "mutation",
      "public",
      {
        resourceId: string;
        resourceType: "document" | "diagram" | "spreadsheet" | "project";
        workspaceId: Id<"workspaces">;
      },
      boolean
    >;
  };
  medias: {
    generateUploadUrl: FunctionReference<"mutation", "public", {}, string>;
    getUrl: FunctionReference<
      "query",
      "public",
      { storageId: Id<"_storage"> },
      string | null
    >;
    saveMedia: FunctionReference<
      "mutation",
      "public",
      {
        fileName: string;
        mimeType: string;
        size: number;
        storageId: Id<"_storage">;
        type: "image";
        workspaceId: Id<"workspaces">;
      },
      string
    >;
  };
  messageReactions: {
    listForMessage: FunctionReference<
      "query",
      "public",
      { messageId: Id<"messages"> },
      Array<{
        count: number;
        currentUserReacted: boolean;
        emoji: string;
        emojiNative: string;
        userIds: Array<string>;
      }>
    >;
    toggle: FunctionReference<
      "mutation",
      "public",
      { emoji: string; emojiNative: string; messageId: Id<"messages"> },
      null
    >;
  };
  messages: {
    getMessageContext: FunctionReference<
      "query",
      "public",
      { contextSize?: number; messageId: Id<"messages"> },
      {
        messages: Array<{
          _creationTime: number;
          _id: Id<"messages">;
          author: string;
          body: string;
          channelId: Id<"channels">;
          deleted: boolean;
          isomorphicId: string;
          mentionedProjects: any;
          mentionedResources: any;
          mentionedTasks: any;
          mentionedUsers: any;
          plainText: string;
          replyTo: null | {
            author: string;
            deleted: boolean;
            plainText: string;
          };
          replyToId?: Id<"messages">;
          userId: Id<"users">;
        }>;
        targetIndex: number;
        targetMessageId: Id<"messages">;
      }
    >;
    list: FunctionReference<
      "query",
      "public",
      {
        channelId: Id<"channels">;
        paginationOpts: {
          cursor: string | null;
          endCursor?: string | null;
          id?: number;
          maximumBytesRead?: number;
          maximumRowsRead?: number;
          numItems: number;
        };
      },
      {
        continueCursor: string;
        isDone: boolean;
        page: Array<{
          _creationTime: number;
          _id: Id<"messages">;
          author: string;
          body: string;
          channelId: Id<"channels">;
          deleted: boolean;
          isomorphicId: string;
          mentionedProjects: any;
          mentionedResources: any;
          mentionedTasks: any;
          mentionedUsers: any;
          plainText: string;
          replyTo: null | {
            author: string;
            deleted: boolean;
            plainText: string;
          };
          replyToId?: Id<"messages">;
          userId: Id<"users">;
        }>;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
        splitCursor?: string | null;
      }
    >;
    remove: FunctionReference<
      "mutation",
      "public",
      { id: Id<"messages"> },
      null
    >;
    search: FunctionReference<
      "query",
      "public",
      { channelId: Id<"channels">; limit?: number; searchTerm: string },
      Array<{
        _creationTime: number;
        _id: Id<"messages">;
        author: string;
        body: string;
        channelId: Id<"channels">;
        deleted: boolean;
        isomorphicId: string;
        mentionedProjects: any;
        mentionedResources: any;
        mentionedTasks: any;
        mentionedUsers: any;
        plainText: string;
        replyTo: null | { author: string; deleted: boolean; plainText: string };
        replyToId?: Id<"messages">;
        userId: Id<"users">;
      }>
    >;
    send: FunctionReference<
      "mutation",
      "public",
      {
        body: string;
        channelId: Id<"channels">;
        isomorphicId: string;
        plainText: string;
        replyToId?: Id<"messages">;
      },
      null
    >;
    update: FunctionReference<
      "mutation",
      "public",
      { body: string; id: Id<"messages">; plainText: string },
      null
    >;
  };
  projects: {
    create: FunctionReference<
      "mutation",
      "public",
      { color: string; name: string; workspaceId: Id<"workspaces"> },
      Id<"projects">
    >;
    get: FunctionReference<
      "query",
      "public",
      { id: Id<"projects"> },
      {
        _creationTime: number;
        _id: Id<"projects">;
        color: string;
        creatorId: Id<"users">;
        description?: string;
        key?: string;
        name: string;
        tags?: Array<string>;
        taskCounter?: number;
        workspaceId: Id<"workspaces">;
      } | null
    >;
    list: FunctionReference<
      "query",
      "public",
      { workspaceId: Id<"workspaces"> },
      Array<{
        _creationTime: number;
        _id: Id<"projects">;
        color: string;
        creatorId: Id<"users">;
        description?: string;
        key?: string;
        name: string;
        tags?: Array<string>;
        taskCounter?: number;
        workspaceId: Id<"workspaces">;
      }>
    >;
    remove: FunctionReference<
      "mutation",
      "public",
      { id: Id<"projects"> },
      null
    >;
    search: FunctionReference<
      "query",
      "public",
      {
        isFavorite?: boolean;
        searchText?: string;
        tags?: Array<string>;
        workspaceId: Id<"workspaces">;
      },
      any
    >;
    update: FunctionReference<
      "mutation",
      "public",
      {
        color?: string;
        description?: string;
        id: Id<"projects">;
        key?: string;
        name?: string;
        tags?: Array<string>;
      },
      null
    >;
  };
  pushNotifications: {
    sendPushNotification: FunctionReference<
      "action",
      "public",
      {
        author: { id: Id<"users">; name: string };
        body: string;
        channelId: Id<"channels">;
      },
      null
    >;
  };
  pushSubscription: {
    listNonSelfSubscriptions: FunctionReference<"query", "public", {}, any>;
    registerSubscription: FunctionReference<
      "mutation",
      "public",
      {
        device: string;
        endpoint: string;
        expirationTime: number | null;
        keys: { auth: string; p256dh: string };
      },
      any
    >;
    unregisterSubscription: FunctionReference<
      "mutation",
      "public",
      { endpoint: string },
      any
    >;
    usersSubscriptions: FunctionReference<
      "query",
      "public",
      { usersIds: Array<Id<"users">> },
      any
    >;
  };
  snapshots: {
    getSnapshotUrl: FunctionReference<
      "query",
      "public",
      {
        resourceId: string;
        resourceType: "doc" | "diagram" | "task" | "spreadsheet";
      },
      string | null
    >;
  };
  spreadsheetCellRefs: {
    ensureCellRef: FunctionReference<
      "mutation",
      "public",
      { cellRef: string; spreadsheetId: Id<"spreadsheets"> },
      null
    >;
    getCellRef: FunctionReference<
      "query",
      "public",
      { cellRef: string; spreadsheetId: Id<"spreadsheets"> },
      any
    >;
    listBySpreadsheet: FunctionReference<
      "query",
      "public",
      { spreadsheetId: Id<"spreadsheets"> },
      Array<{ cellRef: string }>
    >;
    removeCellRef: FunctionReference<
      "mutation",
      "public",
      { cellRef: string; spreadsheetId: Id<"spreadsheets"> },
      null
    >;
  };
  spreadsheets: {
    create: FunctionReference<
      "mutation",
      "public",
      { name?: string; workspaceId: Id<"workspaces"> },
      Id<"spreadsheets">
    >;
    get: FunctionReference<
      "query",
      "public",
      { id: Id<"spreadsheets"> },
      {
        _creationTime: number;
        _id: Id<"spreadsheets">;
        name: string;
        tags?: Array<string>;
        workspaceId: Id<"workspaces">;
        yjsSnapshotId?: Id<"_storage">;
      } | null
    >;
    list: FunctionReference<
      "query",
      "public",
      { workspaceId: Id<"workspaces"> },
      Array<{
        _creationTime: number;
        _id: Id<"spreadsheets">;
        name: string;
        tags?: Array<string>;
        workspaceId: Id<"workspaces">;
        yjsSnapshotId?: Id<"_storage">;
      }>
    >;
    remove: FunctionReference<
      "mutation",
      "public",
      { force?: boolean; id: Id<"spreadsheets"> },
      any
    >;
    rename: FunctionReference<
      "mutation",
      "public",
      { id: Id<"spreadsheets">; name: string },
      null
    >;
    search: FunctionReference<
      "query",
      "public",
      {
        isFavorite?: boolean;
        searchText?: string;
        tags?: Array<string>;
        workspaceId: Id<"workspaces">;
      },
      any
    >;
    updateTags: FunctionReference<
      "mutation",
      "public",
      { id: Id<"spreadsheets">; tags: Array<string> },
      null
    >;
  };
  tags: {
    listWorkspaceTags: FunctionReference<
      "query",
      "public",
      { workspaceId: Id<"workspaces"> },
      Array<string>
    >;
  };
  taskActivity: {
    timeline: FunctionReference<
      "query",
      "public",
      { taskId: Id<"tasks"> },
      any
    >;
  };
  taskComments: {
    create: FunctionReference<
      "mutation",
      "public",
      { body: string; taskId: Id<"tasks"> },
      Id<"taskComments">
    >;
    list: FunctionReference<
      "query",
      "public",
      { taskId: Id<"tasks"> },
      Array<{
        _creationTime: number;
        _id: Id<"taskComments">;
        author: string;
        body: string;
        deleted: boolean;
        image?: string;
        taskId: Id<"tasks">;
        userId: Id<"users">;
      }>
    >;
    remove: FunctionReference<
      "mutation",
      "public",
      { id: Id<"taskComments"> },
      null
    >;
    update: FunctionReference<
      "mutation",
      "public",
      { body: string; id: Id<"taskComments"> },
      null
    >;
  };
  taskDependencies: {
    create: FunctionReference<
      "mutation",
      "public",
      {
        dependsOnTaskId: Id<"tasks">;
        taskId: Id<"tasks">;
        type: "blocks" | "relates_to";
      },
      Id<"taskDependencies">
    >;
    listByTask: FunctionReference<
      "query",
      "public",
      { taskId: Id<"tasks"> },
      any
    >;
    remove: FunctionReference<
      "mutation",
      "public",
      { dependencyId: Id<"taskDependencies"> },
      null
    >;
  };
  tasks: {
    create: FunctionReference<
      "mutation",
      "public",
      {
        assigneeId?: Id<"users">;
        dueDate?: string;
        estimate?: number;
        labels?: Array<string>;
        position?: string;
        priority?: "urgent" | "high" | "medium" | "low";
        projectId: Id<"projects">;
        startDate?: string;
        statusId?: Id<"taskStatuses">;
        title: string;
        workspaceId: Id<"workspaces">;
      },
      Id<"tasks">
    >;
    get: FunctionReference<
      "query",
      "public",
      { taskId: Id<"tasks"> },
      any | null
    >;
    listByAssignee: FunctionReference<
      "query",
      "public",
      { hideCompleted?: boolean; workspaceId: Id<"workspaces"> },
      Array<any>
    >;
    listByProject: FunctionReference<
      "query",
      "public",
      { hideCompleted?: boolean; projectId: Id<"projects"> },
      Array<any>
    >;
    listByWorkspace: FunctionReference<
      "query",
      "public",
      { hideCompleted?: boolean; workspaceId: Id<"workspaces"> },
      Array<any>
    >;
    remove: FunctionReference<
      "mutation",
      "public",
      { taskId: Id<"tasks"> },
      null
    >;
    update: FunctionReference<
      "mutation",
      "public",
      {
        assigneeId?: Id<"users"> | null;
        dueDate?: string | null;
        estimate?: number | null;
        labels?: Array<string>;
        position?: string;
        priority?: "urgent" | "high" | "medium" | "low";
        startDate?: string | null;
        statusId?: Id<"taskStatuses">;
        taskId: Id<"tasks">;
        title?: string;
      },
      null
    >;
    updatePosition: FunctionReference<
      "mutation",
      "public",
      { position: string; statusId: Id<"taskStatuses">; taskId: Id<"tasks"> },
      null
    >;
  };
  taskStatuses: {
    create: FunctionReference<
      "mutation",
      "public",
      {
        color: string;
        isCompleted: boolean;
        name: string;
        projectId: Id<"projects">;
        setsStartDate?: boolean;
      },
      Id<"taskStatuses">
    >;
    listByProject: FunctionReference<
      "query",
      "public",
      { projectId: Id<"projects"> },
      Array<any>
    >;
    remove: FunctionReference<
      "mutation",
      "public",
      { statusId: Id<"taskStatuses"> },
      null
    >;
    reorderColumns: FunctionReference<
      "mutation",
      "public",
      { statusIds: Array<Id<"taskStatuses">> },
      null
    >;
    update: FunctionReference<
      "mutation",
      "public",
      {
        color?: string;
        name?: string;
        order?: number;
        setsStartDate?: boolean;
        statusId: Id<"taskStatuses">;
      },
      null
    >;
  };
  users: {
    get: FunctionReference<
      "query",
      "public",
      { id: Id<"users"> },
      {
        _creationTime: number;
        _id: Id<"users">;
        email?: string;
        emailVerificationTime?: number;
        image?: string;
        isAnonymous?: boolean;
        name?: string;
      } | null
    >;
    getByIds: FunctionReference<
      "query",
      "public",
      { ids: Array<Id<"users">> },
      Record<
        Id<"users">,
        {
          _creationTime: number;
          _id: Id<"users">;
          email?: string;
          emailVerificationTime?: number;
          image?: string;
          isAnonymous?: boolean;
          name?: string;
        }
      >
    >;
    update: FunctionReference<
      "mutation",
      "public",
      { name: string; userId: Id<"users"> },
      null
    >;
    viewer: FunctionReference<
      "query",
      "public",
      {},
      {
        _creationTime: number;
        _id: Id<"users">;
        email?: string;
        emailVerificationTime?: number;
        image?: string;
        isAnonymous?: boolean;
        name?: string;
      } | null
    >;
  };
  workspaceInvites: {
    accept: FunctionReference<
      "mutation",
      "public",
      { inviteId: Id<"workspaceInvites"> },
      any
    >;
    create: FunctionReference<
      "mutation",
      "public",
      { email: string; workspaceId: Id<"workspaces"> },
      any
    >;
    decline: FunctionReference<
      "mutation",
      "public",
      { inviteId: Id<"workspaceInvites"> },
      null
    >;
    listByEmail: FunctionReference<
      "query",
      "public",
      {},
      Array<{
        _creationTime: number;
        _id: Id<"workspaceInvites">;
        email: string;
        invitedBy: Id<"users">;
        inviterName: string;
        status: string;
        workspace: {
          _creationTime: number;
          _id: Id<"workspaces">;
          description?: string;
          name: string;
          ownerId: Id<"users">;
        } | null;
        workspaceId: Id<"workspaces">;
      }>
    >;
  };
  workspaceMembers: {
    byWorkspace: FunctionReference<
      "query",
      "public",
      { workspaceId: Id<"workspaces"> },
      Array<{
        _creationTime: number;
        _id: Id<"workspaceMembers">;
        role: "admin" | "member";
        userId: Id<"users">;
        workspaceId: Id<"workspaces">;
      }>
    >;
    membersByWorkspace: FunctionReference<
      "query",
      "public",
      { workspaceId: Id<"workspaces"> },
      Array<{
        _creationTime: number;
        _id: Id<"users">;
        email?: string;
        emailVerificationTime?: number;
        image?: string;
        isAnonymous?: boolean;
        name?: string;
      }>
    >;
  };
  workspaces: {
    create: FunctionReference<
      "mutation",
      "public",
      { description?: string; name: string },
      Id<"workspaces">
    >;
    get: FunctionReference<
      "query",
      "public",
      { id: Id<"workspaces"> },
      {
        _creationTime: number;
        _id: Id<"workspaces">;
        description?: string;
        name: string;
        ownerId: Id<"users">;
      } | null
    >;
    list: FunctionReference<
      "query",
      "public",
      {},
      Array<{
        _creationTime: number;
        _id: Id<"workspaces">;
        description?: string;
        name: string;
        ownerId: Id<"users">;
      }>
    >;
    update: FunctionReference<
      "mutation",
      "public",
      { description?: string; id: Id<"workspaces">; name: string },
      null
    >;
  };
};

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: {
  auth: {
    store: FunctionReference<
      "mutation",
      "internal",
      {
        args:
          | {
              generateTokens: boolean;
              sessionId?: Id<"authSessions">;
              type: "signIn";
              userId: Id<"users">;
            }
          | { type: "signOut" }
          | { refreshToken: string; type: "refreshSession" }
          | {
              allowExtraProviders: boolean;
              generateTokens: boolean;
              params: any;
              provider?: string;
              type: "verifyCodeAndSignIn";
              verifier?: string;
            }
          | { type: "verifier" }
          | { signature: string; type: "verifierSignature"; verifier: string }
          | {
              profile: any;
              provider: string;
              providerAccountId: string;
              signature: string;
              type: "userOAuth";
            }
          | {
              accountId?: Id<"authAccounts">;
              allowExtraProviders: boolean;
              code: string;
              email?: string;
              expirationTime: number;
              phone?: string;
              provider: string;
              type: "createVerificationCode";
            }
          | {
              account: { id: string; secret?: string };
              profile: any;
              provider: string;
              shouldLinkViaEmail?: boolean;
              shouldLinkViaPhone?: boolean;
              type: "createAccountFromCredentials";
            }
          | {
              account: { id: string; secret?: string };
              provider: string;
              type: "retrieveAccountWithCredentials";
            }
          | {
              account: { id: string; secret: string };
              provider: string;
              type: "modifyAccount";
            }
          | {
              except?: Array<Id<"authSessions">>;
              type: "invalidateSessions";
              userId: Id<"users">;
            };
      },
      any
    >;
  };
  callSessions: {
    createSession: FunctionReference<
      "mutation",
      "internal",
      { channelId: Id<"channels">; cloudflareMeetingId: string },
      null | string
    >;
    getActiveSession: FunctionReference<
      "query",
      "internal",
      { channelId: Id<"channels"> },
      any
    >;
  };
  channels: {
    getInternal: FunctionReference<
      "query",
      "internal",
      { id: Id<"channels"> },
      {
        _creationTime: number;
        _id: Id<"channels">;
        isPublic: boolean;
        name: string;
        roleCount: { admin: number; member: number };
        workspaceId: Id<"workspaces">;
      } | null
    >;
  };
  chatNotifications: {
    notifyMessageMentions: FunctionReference<
      "action",
      "internal",
      {
        channelId: Id<"channels">;
        mentionedBy: { id: Id<"users">; name: string };
        mentionedUserIds: Array<string>;
        plainText: string;
      },
      null
    >;
  };
  collaboration: {
    checkAccess: FunctionReference<
      "query",
      "internal",
      {
        resourceId: string;
        resourceType: "doc" | "diagram" | "task" | "presence" | "spreadsheet";
        userId: Id<"users">;
      },
      boolean
    >;
    checkDiagramAccess: FunctionReference<
      "query",
      "internal",
      { diagramId: string; userId: Id<"users"> },
      boolean
    >;
    checkDocumentAccess: FunctionReference<
      "query",
      "internal",
      { documentId: string; userId: Id<"users"> },
      boolean
    >;
    checkSpreadsheetAccess: FunctionReference<
      "query",
      "internal",
      { spreadsheetId: string; userId: Id<"users"> },
      boolean
    >;
    checkTaskAccess: FunctionReference<
      "query",
      "internal",
      { taskId: string; userId: Id<"users"> },
      boolean
    >;
    checkWorkspaceAccess: FunctionReference<
      "query",
      "internal",
      { userId: Id<"users">; workspaceId: string },
      boolean
    >;
    consumeToken: FunctionReference<
      "mutation",
      "internal",
      { token: string },
      { roomId: string; userId: Id<"users"> } | null
    >;
    getUserInfo: FunctionReference<
      "query",
      "internal",
      { userId: Id<"users"> },
      { userId: Id<"users">; userImage?: string; userName?: string }
    >;
    storeToken: FunctionReference<
      "mutation",
      "internal",
      { expiresAt: number; roomId: string; token: string; userId: Id<"users"> },
      null
    >;
  };
  contentReferences: {
    removeAllForSource: FunctionReference<
      "mutation",
      "internal",
      { sourceId: string },
      null
    >;
    removeAllForTarget: FunctionReference<
      "mutation",
      "internal",
      { targetId: string },
      null
    >;
  };
  emails: {
    sendWorkspaceInvite: FunctionReference<
      "action",
      "internal",
      {
        inviteId: Id<"workspaceInvites">;
        inviterName: string;
        recipientEmail: string;
        workspaceName: string;
      },
      any
    >;
  };
  migrations: {
    backfillTaskIds: {
      backfill: FunctionReference<"mutation", "internal", {}, null>;
    };
    migrateTaskStatusesToProject: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
      },
      any
    >;
    run: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
      },
      any
    >;
    stripDeprecatedFields: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
      },
      any
    >;
    stripDiagramFields: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
      },
      any
    >;
    stripDocumentFields: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
      },
      any
    >;
    stripSpreadsheetFields: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
      },
      any
    >;
  };
  snapshots: {
    getSnapshot: FunctionReference<
      "query",
      "internal",
      {
        resourceId: string;
        resourceType: "doc" | "diagram" | "task" | "spreadsheet";
      },
      Id<"_storage"> | null
    >;
    saveSnapshot: FunctionReference<
      "mutation",
      "internal",
      {
        resourceId: string;
        resourceType: "doc" | "diagram" | "task" | "spreadsheet";
        storageId: Id<"_storage">;
      },
      null
    >;
  };
  spreadsheetCellRefs: {
    getReferencedCellRefs: FunctionReference<
      "query",
      "internal",
      { spreadsheetId: Id<"spreadsheets"> },
      any
    >;
    getSpreadsheetInternal: FunctionReference<
      "query",
      "internal",
      { id: Id<"spreadsheets"> },
      any
    >;
    upsertCellValues: FunctionReference<
      "mutation",
      "internal",
      {
        spreadsheetId: Id<"spreadsheets">;
        updates: Array<{ cellRef: string; values: string }>;
      },
      null
    >;
  };
  spreadsheetCellRefsNode: {
    populateFromSnapshot: FunctionReference<
      "action",
      "internal",
      { cellRef: string; spreadsheetId: Id<"spreadsheets"> },
      null
    >;
  };
  taskNotifications: {
    notifyTaskAssignment: FunctionReference<
      "action",
      "internal",
      {
        assignedBy: { id: Id<"users">; name: string };
        assigneeId: Id<"users">;
        taskId: Id<"tasks">;
        taskTitle: string;
      },
      null
    >;
    notifyUserMentions: FunctionReference<
      "action",
      "internal",
      {
        context: "task description" | "comment";
        mentionedBy: { id: Id<"users">; name: string };
        mentionedUserIds: Array<string>;
        taskId: Id<"tasks">;
        taskTitle: string;
      },
      null
    >;
  };
};

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
