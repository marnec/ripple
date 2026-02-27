/* eslint-disable */
/**
 * Generated data model types.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  DocumentByName,
  TableNamesInDataModel,
  SystemTableNames,
  AnyDataModel,
} from "convex/server";
import type { GenericId } from "convex/values";

/**
 * A type describing your Convex data model.
 *
 * This type includes information about what tables you have, the type of
 * documents stored in those tables, and the indexes defined on them.
 *
 * This type is used to parameterize methods like `queryGeneric` and
 * `mutationGeneric` to make them type-safe.
 */

export type DataModel = {
  authAccounts: {
    document: {
      emailVerified?: string;
      phoneVerified?: string;
      provider: string;
      providerAccountId: string;
      secret?: string;
      userId: Id<"users">;
      _id: Id<"authAccounts">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "emailVerified"
      | "phoneVerified"
      | "provider"
      | "providerAccountId"
      | "secret"
      | "userId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      providerAndAccountId: ["provider", "providerAccountId", "_creationTime"];
      userIdAndProvider: ["userId", "provider", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  authRateLimits: {
    document: {
      attemptsLeft: number;
      identifier: string;
      lastAttemptTime: number;
      _id: Id<"authRateLimits">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "attemptsLeft"
      | "identifier"
      | "lastAttemptTime";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      identifier: ["identifier", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  authRefreshTokens: {
    document: {
      expirationTime: number;
      firstUsedTime?: number;
      parentRefreshTokenId?: Id<"authRefreshTokens">;
      sessionId: Id<"authSessions">;
      _id: Id<"authRefreshTokens">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "expirationTime"
      | "firstUsedTime"
      | "parentRefreshTokenId"
      | "sessionId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      sessionId: ["sessionId", "_creationTime"];
      sessionIdAndParentRefreshTokenId: [
        "sessionId",
        "parentRefreshTokenId",
        "_creationTime",
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  authSessions: {
    document: {
      expirationTime: number;
      userId: Id<"users">;
      _id: Id<"authSessions">;
      _creationTime: number;
    };
    fieldPaths: "_creationTime" | "_id" | "expirationTime" | "userId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      userId: ["userId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  authVerificationCodes: {
    document: {
      accountId: Id<"authAccounts">;
      code: string;
      emailVerified?: string;
      expirationTime: number;
      phoneVerified?: string;
      provider: string;
      verifier?: string;
      _id: Id<"authVerificationCodes">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "accountId"
      | "code"
      | "emailVerified"
      | "expirationTime"
      | "phoneVerified"
      | "provider"
      | "verifier";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      accountId: ["accountId", "_creationTime"];
      code: ["code", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  authVerifiers: {
    document: {
      sessionId?: Id<"authSessions">;
      signature?: string;
      _id: Id<"authVerifiers">;
      _creationTime: number;
    };
    fieldPaths: "_creationTime" | "_id" | "sessionId" | "signature";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      signature: ["signature", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  callSessions: {
    document: {
      active: boolean;
      channelId: Id<"channels">;
      cloudflareMeetingId: string;
      _id: Id<"callSessions">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "active"
      | "channelId"
      | "cloudflareMeetingId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_channel_active: ["channelId", "active", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  channelMembers: {
    document: {
      channelId: Id<"channels">;
      role: "admin" | "member";
      userId: Id<"users">;
      workspaceId: Id<"workspaces">;
      _id: Id<"channelMembers">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "channelId"
      | "role"
      | "userId"
      | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_channel: ["channelId", "_creationTime"];
      by_channel_role: ["channelId", "role", "_creationTime"];
      by_channel_user: ["channelId", "userId", "_creationTime"];
      by_user: ["userId", "_creationTime"];
      by_workspace_user: ["workspaceId", "userId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  channels: {
    document: {
      isPublic: boolean;
      name: string;
      roleCount: { admin: number; member: number };
      workspaceId: Id<"workspaces">;
      _id: Id<"channels">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "isPublic"
      | "name"
      | "roleCount"
      | "roleCount.admin"
      | "roleCount.member"
      | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_isPublicInWorkspace: ["isPublic", "workspaceId", "_creationTime"];
      by_workspace: ["workspaceId", "_creationTime"];
    };
    searchIndexes: {
      by_name: {
        searchField: "name";
        filterFields: "workspaceId";
      };
    };
    vectorIndexes: {};
  };
  collaborationTokens: {
    document: {
      expiresAt: number;
      roomId: string;
      token: string;
      userId: Id<"users">;
      _id: Id<"collaborationTokens">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "expiresAt"
      | "roomId"
      | "token"
      | "userId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_token: ["token", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  contentReferences: {
    document: {
      sourceId: string;
      sourceType: "document" | "task";
      targetId: string;
      targetType: "diagram" | "spreadsheet";
      workspaceId: Id<"workspaces">;
      _id: Id<"contentReferences">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "sourceId"
      | "sourceType"
      | "targetId"
      | "targetType"
      | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_source: ["sourceId", "_creationTime"];
      by_target: ["targetId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  diagrams: {
    document: {
      name: string;
      tags?: Array<string>;
      workspaceId: Id<"workspaces">;
      yjsSnapshotId?: Id<"_storage">;
      _id: Id<"diagrams">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "name"
      | "tags"
      | "workspaceId"
      | "yjsSnapshotId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_workspace: ["workspaceId", "_creationTime"];
    };
    searchIndexes: {
      by_name: {
        searchField: "name";
        filterFields: "workspaceId";
      };
    };
    vectorIndexes: {};
  };
  documents: {
    document: {
      name: string;
      tags?: Array<string>;
      workspaceId: Id<"workspaces">;
      yjsSnapshotId?: Id<"_storage">;
      _id: Id<"documents">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "name"
      | "tags"
      | "workspaceId"
      | "yjsSnapshotId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_workspace: ["workspaceId", "_creationTime"];
    };
    searchIndexes: {
      by_name: {
        searchField: "name";
        filterFields: "workspaceId";
      };
    };
    vectorIndexes: {};
  };
  favorites: {
    document: {
      favoritedAt: number;
      resourceId: string;
      resourceType: "document" | "diagram" | "spreadsheet" | "project";
      userId: Id<"users">;
      workspaceId: Id<"workspaces">;
      _id: Id<"favorites">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "favoritedAt"
      | "resourceId"
      | "resourceType"
      | "userId"
      | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_user_resource: ["userId", "resourceId", "_creationTime"];
      by_workspace_user: ["workspaceId", "userId", "_creationTime"];
      by_workspace_user_type: [
        "workspaceId",
        "userId",
        "resourceType",
        "_creationTime",
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  medias: {
    document: {
      fileName: string;
      mimeType: string;
      size: number;
      storageId: Id<"_storage">;
      type: "image";
      uploadedBy: Id<"users">;
      workspaceId: Id<"workspaces">;
      _id: Id<"medias">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "fileName"
      | "mimeType"
      | "size"
      | "storageId"
      | "type"
      | "uploadedBy"
      | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_storage_id: ["storageId", "_creationTime"];
      by_workspace: ["workspaceId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  messageReactions: {
    document: {
      emoji: string;
      emojiNative: string;
      messageId: Id<"messages">;
      userId: Id<"users">;
      _id: Id<"messageReactions">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "emoji"
      | "emojiNative"
      | "messageId"
      | "userId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_message: ["messageId", "_creationTime"];
      by_message_emoji_user: ["messageId", "emoji", "userId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  messages: {
    document: {
      body: string;
      channelId: Id<"channels">;
      deleted: boolean;
      isomorphicId: string;
      plainText: string;
      replyToId?: Id<"messages">;
      userId: Id<"users">;
      _id: Id<"messages">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "body"
      | "channelId"
      | "deleted"
      | "isomorphicId"
      | "plainText"
      | "replyToId"
      | "userId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_channel: ["channelId", "_creationTime"];
      undeleted_by_channel: ["channelId", "deleted", "_creationTime"];
    };
    searchIndexes: {
      by_text: {
        searchField: "plainText";
        filterFields: "channelId";
      };
    };
    vectorIndexes: {};
  };
  projects: {
    document: {
      color: string;
      creatorId: Id<"users">;
      description?: string;
      key?: string;
      name: string;
      tags?: Array<string>;
      taskCounter?: number;
      workspaceId: Id<"workspaces">;
      _id: Id<"projects">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "color"
      | "creatorId"
      | "description"
      | "key"
      | "name"
      | "tags"
      | "taskCounter"
      | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_workspace: ["workspaceId", "_creationTime"];
      by_workspace_key: ["workspaceId", "key", "_creationTime"];
    };
    searchIndexes: {
      by_name: {
        searchField: "name";
        filterFields: "workspaceId";
      };
    };
    vectorIndexes: {};
  };
  pushSubscriptions: {
    document: {
      device: string;
      endpoint: string;
      expirationTime: number | null;
      keys: { auth: string; p256dh: string };
      userId: Id<"users">;
      _id: Id<"pushSubscriptions">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "device"
      | "endpoint"
      | "expirationTime"
      | "keys"
      | "keys.auth"
      | "keys.p256dh"
      | "userId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_endpoint: ["endpoint", "_creationTime"];
      by_user: ["userId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  spreadsheetCellRefs: {
    document: {
      cellRef: string;
      spreadsheetId: Id<"spreadsheets">;
      updatedAt: number;
      values: string;
      _id: Id<"spreadsheetCellRefs">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "cellRef"
      | "spreadsheetId"
      | "updatedAt"
      | "values";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_spreadsheet: ["spreadsheetId", "_creationTime"];
      by_spreadsheet_cellRef: ["spreadsheetId", "cellRef", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  spreadsheets: {
    document: {
      name: string;
      tags?: Array<string>;
      workspaceId: Id<"workspaces">;
      yjsSnapshotId?: Id<"_storage">;
      _id: Id<"spreadsheets">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "name"
      | "tags"
      | "workspaceId"
      | "yjsSnapshotId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_workspace: ["workspaceId", "_creationTime"];
    };
    searchIndexes: {
      by_name: {
        searchField: "name";
        filterFields: "workspaceId";
      };
    };
    vectorIndexes: {};
  };
  taskActivity: {
    document: {
      newValue?: string;
      oldValue?: string;
      taskId: Id<"tasks">;
      type:
        | "created"
        | "status_change"
        | "priority_change"
        | "assignee_change"
        | "label_add"
        | "label_remove"
        | "title_change"
        | "due_date_change"
        | "start_date_change"
        | "estimate_change"
        | "dependency_add"
        | "dependency_remove"
        | "comment_edit"
        | "comment_delete";
      userId: Id<"users">;
      _id: Id<"taskActivity">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "newValue"
      | "oldValue"
      | "taskId"
      | "type"
      | "userId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_task: ["taskId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  taskComments: {
    document: {
      body: string;
      deleted: boolean;
      taskId: Id<"tasks">;
      userId: Id<"users">;
      _id: Id<"taskComments">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "body"
      | "deleted"
      | "taskId"
      | "userId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_task: ["taskId", "_creationTime"];
      undeleted_by_task: ["taskId", "deleted", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  taskDependencies: {
    document: {
      creatorId: Id<"users">;
      dependsOnTaskId: Id<"tasks">;
      taskId: Id<"tasks">;
      type: "blocks" | "relates_to";
      _id: Id<"taskDependencies">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "creatorId"
      | "dependsOnTaskId"
      | "taskId"
      | "type";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_depends_on: ["dependsOnTaskId", "_creationTime"];
      by_pair: ["taskId", "dependsOnTaskId", "_creationTime"];
      by_task: ["taskId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  tasks: {
    document: {
      assigneeId?: Id<"users">;
      completed: boolean;
      creatorId: Id<"users">;
      dueDate?: string;
      estimate?: number;
      labels?: Array<string>;
      number?: number;
      position?: string;
      priority: "urgent" | "high" | "medium" | "low";
      projectId: Id<"projects">;
      startDate?: string;
      statusId: Id<"taskStatuses">;
      title: string;
      workspaceId: Id<"workspaces">;
      yjsSnapshotId?: Id<"_storage">;
      _id: Id<"tasks">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "assigneeId"
      | "completed"
      | "creatorId"
      | "dueDate"
      | "estimate"
      | "labels"
      | "number"
      | "position"
      | "priority"
      | "projectId"
      | "startDate"
      | "statusId"
      | "title"
      | "workspaceId"
      | "yjsSnapshotId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_assignee: ["assigneeId", "_creationTime"];
      by_assignee_completed: ["assigneeId", "completed", "_creationTime"];
      by_project: ["projectId", "_creationTime"];
      by_project_completed: ["projectId", "completed", "_creationTime"];
      by_project_number: ["projectId", "number", "_creationTime"];
      by_project_status: ["projectId", "statusId", "_creationTime"];
      by_project_status_position: [
        "projectId",
        "statusId",
        "position",
        "_creationTime",
      ];
      by_workspace: ["workspaceId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  taskStatuses: {
    document: {
      color: string;
      isCompleted: boolean;
      isDefault: boolean;
      name: string;
      order: number;
      projectId: Id<"projects">;
      setsStartDate?: boolean;
      _id: Id<"taskStatuses">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "color"
      | "isCompleted"
      | "isDefault"
      | "name"
      | "order"
      | "projectId"
      | "setsStartDate";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_project: ["projectId", "_creationTime"];
      by_project_order: ["projectId", "order", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  users: {
    document: {
      email?: string;
      emailVerificationTime?: number;
      image?: string;
      isAnonymous?: boolean;
      name?: string;
      phone?: string;
      phoneVerificationTime?: number;
      _id: Id<"users">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "email"
      | "emailVerificationTime"
      | "image"
      | "isAnonymous"
      | "name"
      | "phone"
      | "phoneVerificationTime";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      email: ["email", "_creationTime"];
      phone: ["phone", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  workspaceInvites: {
    document: {
      email: string;
      invitedBy: Id<"users">;
      status: "pending" | "accepted" | "declined";
      workspaceId: Id<"workspaces">;
      _id: Id<"workspaceInvites">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "email"
      | "invitedBy"
      | "status"
      | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_email: ["email", "_creationTime"];
      by_email_and_status: ["email", "status", "_creationTime"];
      by_workspace: ["workspaceId", "_creationTime"];
      by_workspace_by_email_by_status: [
        "workspaceId",
        "email",
        "status",
        "_creationTime",
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  workspaceMembers: {
    document: {
      role: "admin" | "member";
      userId: Id<"users">;
      workspaceId: Id<"workspaces">;
      _id: Id<"workspaceMembers">;
      _creationTime: number;
    };
    fieldPaths: "_creationTime" | "_id" | "role" | "userId" | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_user: ["userId", "_creationTime"];
      by_workspace: ["workspaceId", "_creationTime"];
      by_workspace_user: ["workspaceId", "userId", "_creationTime"];
      by_workspace_user_and_role: [
        "workspaceId",
        "userId",
        "role",
        "_creationTime",
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  workspaces: {
    document: {
      description?: string;
      name: string;
      ownerId: Id<"users">;
      _id: Id<"workspaces">;
      _creationTime: number;
    };
    fieldPaths: "_creationTime" | "_id" | "description" | "name" | "ownerId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
};

/**
 * The names of all of your Convex tables.
 */
export type TableNames = TableNamesInDataModel<DataModel>;

/**
 * The type of a document stored in Convex.
 *
 * @typeParam TableName - A string literal type of the table name (like "users").
 */
export type Doc<TableName extends TableNames> = DocumentByName<
  DataModel,
  TableName
>;

/**
 * An identifier for a document in Convex.
 *
 * Convex documents are uniquely identified by their `Id`, which is accessible
 * on the `_id` field. To learn more, see [Document IDs](https://docs.convex.dev/using/document-ids).
 *
 * Documents can be loaded using `db.get(tableName, id)` in query and mutation functions.
 *
 * IDs are just strings at runtime, but this type can be used to distinguish them from other
 * strings when type checking.
 *
 * @typeParam TableName - A string literal type of the table name (like "users").
 */
export type Id<TableName extends TableNames | SystemTableNames> =
  GenericId<TableName>;
