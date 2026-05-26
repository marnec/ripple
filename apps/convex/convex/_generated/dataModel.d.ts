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
  appVersion: {
    document: {
      deployedAt: number;
      _id: Id<"appVersion">;
      _creationTime: number;
    };
    fieldPaths: "_creationTime" | "_id" | "deployedAt";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
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
  calendarEventInvitees: {
    document: {
      eventId: Id<"calendarEvents">;
      guestEmail?: string;
      guestName?: string;
      guestSub?: string;
      lastRsvpDtstamp?: number;
      lastRsvpSequence?: number;
      respondedAt?: number;
      shareId?: string;
      status: "pending" | "accepted" | "declined" | "tentative";
      userId?: Id<"users">;
      workspaceId: Id<"workspaces">;
      _id: Id<"calendarEventInvitees">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "eventId"
      | "guestEmail"
      | "guestName"
      | "guestSub"
      | "lastRsvpDtstamp"
      | "lastRsvpSequence"
      | "respondedAt"
      | "shareId"
      | "status"
      | "userId"
      | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_event: ["eventId", "_creationTime"];
      by_event_guest_email: ["eventId", "guestEmail", "_creationTime"];
      by_event_user: ["eventId", "userId", "_creationTime"];
      by_share: ["shareId", "_creationTime"];
      by_user_workspace_event: [
        "userId",
        "workspaceId",
        "eventId",
        "_creationTime",
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  calendarEvents: {
    document: {
      channelId?: Id<"channels">;
      cloudflareMeetingId?: string;
      createdBy: Id<"users">;
      description?: string;
      endsAt: number;
      sequence?: number;
      startsAt: number;
      tags?: Array<string>;
      timezone: string;
      title: string;
      workspaceId: Id<"workspaces">;
      _id: Id<"calendarEvents">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "channelId"
      | "cloudflareMeetingId"
      | "createdBy"
      | "description"
      | "endsAt"
      | "sequence"
      | "startsAt"
      | "tags"
      | "timezone"
      | "title"
      | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_channel: ["channelId", "_creationTime"];
      by_creator: ["createdBy", "_creationTime"];
      by_workspace_starts: ["workspaceId", "startsAt", "_creationTime"];
    };
    searchIndexes: {
      by_title: {
        searchField: "title";
        filterFields: "workspaceId";
      };
    };
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
  channelJoinRequests: {
    document: {
      channelId: Id<"channels">;
      decidedAt?: number;
      decidedBy?: Id<"users">;
      status: "pending" | "approved" | "denied";
      userId: Id<"users">;
      workspaceId: Id<"workspaces">;
      _id: Id<"channelJoinRequests">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "channelId"
      | "decidedAt"
      | "decidedBy"
      | "status"
      | "userId"
      | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_channel_status: ["channelId", "status", "_creationTime"];
      by_channel_user_status: [
        "channelId",
        "userId",
        "status",
        "_creationTime",
      ];
      by_user_status: ["userId", "status", "_creationTime"];
      by_workspace_status: ["workspaceId", "status", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  channelMembers: {
    document: {
      channelId: Id<"channels">;
      email?: string;
      lastReadAt?: number;
      name?: string;
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
      | "email"
      | "lastReadAt"
      | "name"
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
  channelNotificationPreferences: {
    document: {
      channelId: Id<"channels">;
      chatChannelMessage: boolean;
      chatMention: boolean;
      userId: Id<"users">;
      _id: Id<"channelNotificationPreferences">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "channelId"
      | "chatChannelMessage"
      | "chatMention"
      | "userId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_channel: ["channelId", "_creationTime"];
      by_user_channel: ["userId", "channelId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  channels: {
    document: {
      name: string;
      type: "open" | "closed" | "dm";
      workspaceId: Id<"workspaces">;
      _id: Id<"channels">;
      _creationTime: number;
    };
    fieldPaths: "_creationTime" | "_id" | "name" | "type" | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_type_workspace: ["type", "workspaceId", "_creationTime"];
      by_workspace: ["workspaceId", "_creationTime"];
    };
    searchIndexes: {
      by_name: {
        searchField: "name";
        filterFields: "type" | "workspaceId";
      };
    };
    vectorIndexes: {};
  };
  cycles: {
    document: {
      creatorId: Id<"users">;
      description?: string;
      dueDate?: string;
      name: string;
      projectId: Id<"projects">;
      startDate?: string;
      status: "draft" | "upcoming" | "active" | "completed";
      workspaceId: Id<"workspaces">;
      _id: Id<"cycles">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "creatorId"
      | "description"
      | "dueDate"
      | "name"
      | "projectId"
      | "startDate"
      | "status"
      | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_project: ["projectId", "_creationTime"];
      by_project_status: ["projectId", "status", "_creationTime"];
      by_workspace: ["workspaceId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  cycleTasks: {
    document: {
      addedBy: Id<"users">;
      cycleId: Id<"cycles">;
      projectId: Id<"projects">;
      taskId: Id<"tasks">;
      _id: Id<"cycleTasks">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "addedBy"
      | "cycleId"
      | "projectId"
      | "taskId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_cycle: ["cycleId", "_creationTime"];
      by_cycle_task: ["cycleId", "taskId", "_creationTime"];
      by_task: ["taskId", "_creationTime"];
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
      by_yjsSnapshotId: ["yjsSnapshotId", "_creationTime"];
    };
    searchIndexes: {
      by_name: {
        searchField: "name";
        filterFields: "workspaceId";
      };
    };
    vectorIndexes: {};
  };
  documentBlockRefs: {
    document: {
      blockId: string;
      blockType: string;
      documentId: Id<"documents">;
      textContent: string;
      updatedAt: number;
      _id: Id<"documentBlockRefs">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "blockId"
      | "blockType"
      | "documentId"
      | "textContent"
      | "updatedAt";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_document: ["documentId", "_creationTime"];
      by_document_blockId: ["documentId", "blockId", "_creationTime"];
    };
    searchIndexes: {};
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
      by_yjsSnapshotId: ["yjsSnapshotId", "_creationTime"];
    };
    searchIndexes: {
      by_name: {
        searchField: "name";
        filterFields: "workspaceId";
      };
    };
    vectorIndexes: {};
  };
  edges: {
    document: {
      createdAt: number;
      createdBy?: Id<"users">;
      edgeType:
        | "embeds"
        | "blocks"
        | "relates_to"
        | "mentions"
        | "belongs_to"
        | "hosted_in"
        | "invites";
      sourceId: string;
      sourceNodeId?: Id<"nodes">;
      sourceType:
        | "document"
        | "task"
        | "diagram"
        | "spreadsheet"
        | "channel"
        | "calendarEvent";
      targetId: string;
      targetNodeId?: Id<"nodes">;
      targetType:
        | "document"
        | "task"
        | "diagram"
        | "spreadsheet"
        | "user"
        | "project"
        | "channel"
        | "calendarEvent";
      workspaceId: Id<"workspaces">;
      _id: Id<"edges">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "createdAt"
      | "createdBy"
      | "edgeType"
      | "sourceId"
      | "sourceNodeId"
      | "sourceType"
      | "targetId"
      | "targetNodeId"
      | "targetType"
      | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_source: ["sourceId", "_creationTime"];
      by_source_edgetype: ["sourceId", "edgeType", "_creationTime"];
      by_source_target: ["sourceId", "targetId", "_creationTime"];
      by_target: ["targetId", "_creationTime"];
      by_target_edgetype: ["targetId", "edgeType", "_creationTime"];
      by_workspace: ["workspaceId", "_creationTime"];
      by_workspace_target: ["workspaceId", "targetId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  entityTags: {
    document: {
      resourceId: string;
      resourceType:
        | "document"
        | "diagram"
        | "spreadsheet"
        | "project"
        | "calendarEvent";
      tagId: Id<"tags">;
      tagName: string;
      workspaceId: Id<"workspaces">;
      _id: Id<"entityTags">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "resourceId"
      | "resourceType"
      | "tagId"
      | "tagName"
      | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_resource_id: ["resourceId", "_creationTime"];
      by_workspace_tag: ["workspaceId", "tagId", "_creationTime"];
      by_workspace_tag_type: [
        "workspaceId",
        "tagId",
        "resourceType",
        "_creationTime",
      ];
    };
    searchIndexes: {};
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
      by_resource_id: ["resourceId", "_creationTime"];
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
  integrationInstallStates: {
    document: {
      expiresAt: number;
      nonce: string;
      provider: string;
      userId: Id<"users">;
      workspaceId: Id<"workspaces">;
      _id: Id<"integrationInstallStates">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "expiresAt"
      | "nonce"
      | "provider"
      | "userId"
      | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_nonce: ["nonce", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  integrationOutboundRuns: {
    document: {
      runId: string;
      taskId: Id<"tasks">;
      _id: Id<"integrationOutboundRuns">;
      _creationTime: number;
    };
    fieldPaths: "_creationTime" | "_id" | "runId" | "taskId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_runId: ["runId", "_creationTime"];
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
  nodes: {
    document: {
      metadata?: { projectId: Id<"projects">; type: "task" };
      name: string;
      resourceId: string;
      resourceType:
        | "document"
        | "diagram"
        | "spreadsheet"
        | "project"
        | "channel"
        | "task"
        | "user"
        | "calendarEvent";
      searchable?: boolean;
      tags: Array<string>;
      workspaceId: Id<"workspaces">;
      _id: Id<"nodes">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "metadata"
      | "metadata.projectId"
      | "metadata.type"
      | "name"
      | "resourceId"
      | "resourceType"
      | "searchable"
      | "tags"
      | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_resource: ["resourceId", "_creationTime"];
      by_resource_workspace: ["resourceId", "workspaceId", "_creationTime"];
      by_workspace: ["workspaceId", "_creationTime"];
      by_workspace_type: ["workspaceId", "resourceType", "_creationTime"];
    };
    searchIndexes: {
      by_name: {
        searchField: "name";
        filterFields: "resourceType" | "searchable" | "workspaceId";
      };
    };
    vectorIndexes: {};
  };
  notificationPreferences: {
    document: {
      channelCreated: boolean;
      channelDeleted: boolean;
      channelJoinDecision?: boolean;
      channelJoinRequest?: boolean;
      chatChannelMessage: boolean;
      chatMention: boolean;
      diagramCreated: boolean;
      diagramDeleted: boolean;
      documentCreated: boolean;
      documentDeleted: boolean;
      documentMention: boolean;
      eventCancelled?: boolean | { email: boolean; push: boolean };
      eventInvited?: boolean | { email: boolean; push: boolean };
      eventResponseChanged?: boolean;
      eventUpdated?: boolean | { email: boolean; push: boolean };
      projectCreated: boolean;
      projectDeleted: boolean;
      spreadsheetCreated: boolean;
      spreadsheetDeleted: boolean;
      taskAssigned: boolean;
      taskComment: boolean;
      taskCommentMention: boolean;
      taskDescriptionMention: boolean;
      taskStatusChange: boolean;
      userId: Id<"users">;
      _id: Id<"notificationPreferences">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "channelCreated"
      | "channelDeleted"
      | "channelJoinDecision"
      | "channelJoinRequest"
      | "chatChannelMessage"
      | "chatMention"
      | "diagramCreated"
      | "diagramDeleted"
      | "documentCreated"
      | "documentDeleted"
      | "documentMention"
      | "eventCancelled"
      | "eventCancelled.email"
      | "eventCancelled.push"
      | "eventInvited"
      | "eventInvited.email"
      | "eventInvited.push"
      | "eventResponseChanged"
      | "eventUpdated"
      | "eventUpdated.email"
      | "eventUpdated.push"
      | "projectCreated"
      | "projectDeleted"
      | "spreadsheetCreated"
      | "spreadsheetDeleted"
      | "taskAssigned"
      | "taskComment"
      | "taskCommentMention"
      | "taskDescriptionMention"
      | "taskStatusChange"
      | "userId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_user: ["userId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  notificationSubscriptions: {
    document: {
      category: string;
      scope: string;
      userId: Id<"users">;
      workspaceId: Id<"workspaces">;
      _id: Id<"notificationSubscriptions">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "category"
      | "scope"
      | "userId"
      | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_scope_category: ["scope", "category", "_creationTime"];
      by_user_scope: ["userId", "scope", "_creationTime"];
      by_user_scope_category: ["userId", "scope", "category", "_creationTime"];
      by_user_workspace: ["userId", "workspaceId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  projectIntegrationLinks: {
    document: {
      branchStatusMap?: Array<{ branch: string; statusId: Id<"taskStatuses"> }>;
      externalRepoFullName: string;
      externalRepoId: string;
      frozenAt?: number;
      lastWebhookAt?: number;
      pausedByBilling: boolean;
      projectId: Id<"projects">;
      status: "configuring" | "active" | "paused" | "disconnected";
      workspaceId: Id<"workspaces">;
      _id: Id<"projectIntegrationLinks">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "branchStatusMap"
      | "externalRepoFullName"
      | "externalRepoId"
      | "frozenAt"
      | "lastWebhookAt"
      | "pausedByBilling"
      | "projectId"
      | "status"
      | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_externalRepo: ["externalRepoId", "_creationTime"];
      by_project: ["projectId", "_creationTime"];
      by_workspace: ["workspaceId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  projectNotificationPreferences: {
    document: {
      projectId: Id<"projects">;
      taskAssigned: boolean;
      taskComment: boolean;
      taskCommentMention: boolean;
      taskDescriptionMention: boolean;
      taskStatusChange: boolean;
      userId: Id<"users">;
      _id: Id<"projectNotificationPreferences">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "projectId"
      | "taskAssigned"
      | "taskComment"
      | "taskCommentMention"
      | "taskDescriptionMention"
      | "taskStatusChange"
      | "userId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_project: ["projectId", "_creationTime"];
      by_user_project: ["userId", "projectId", "_creationTime"];
    };
    searchIndexes: {};
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
  pullRequests: {
    document: {
      baseRef: string;
      externalAuthor: { avatarUrl: string; login: string; url: string };
      externalPrId: string;
      externalUpdatedAt: number;
      headRef: string;
      mergedAt?: number;
      number: number;
      projectIntegrationLinkId: Id<"projectIntegrationLinks">;
      provider: string;
      state: "draft" | "open" | "merged" | "closed";
      title: string;
      url: string;
      workspaceId: Id<"workspaces">;
      _id: Id<"pullRequests">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "baseRef"
      | "externalAuthor"
      | "externalAuthor.avatarUrl"
      | "externalAuthor.login"
      | "externalAuthor.url"
      | "externalPrId"
      | "externalUpdatedAt"
      | "headRef"
      | "mergedAt"
      | "number"
      | "projectIntegrationLinkId"
      | "provider"
      | "state"
      | "title"
      | "url"
      | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_link_externalPrId: [
        "projectIntegrationLinkId",
        "externalPrId",
        "_creationTime",
      ];
      by_workspace: ["workspaceId", "_creationTime"];
    };
    searchIndexes: {};
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
  recentActivity: {
    document: {
      resourceId: string;
      resourceName: string;
      resourceType:
        | "channel"
        | "document"
        | "diagram"
        | "spreadsheet"
        | "project";
      userId: Id<"users">;
      visitedAt: number;
      workspaceId: Id<"workspaces">;
      _id: Id<"recentActivity">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "resourceId"
      | "resourceName"
      | "resourceType"
      | "userId"
      | "visitedAt"
      | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_resource_id: ["resourceId", "_creationTime"];
      by_user_resource: ["userId", "resourceId", "_creationTime"];
      by_user_workspace: ["userId", "workspaceId", "_creationTime"];
      by_user_workspace_visited: [
        "userId",
        "workspaceId",
        "visitedAt",
        "_creationTime",
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  resourceShares: {
    document: {
      accessLevel: "view" | "edit" | "join";
      createdAt: number;
      createdBy: Id<"users">;
      expiresAt?: number;
      lastUsedAt?: number;
      name?: string;
      resourceId: string;
      resourceType:
        | "document"
        | "diagram"
        | "spreadsheet"
        | "channel"
        | "calendarEvent";
      revokedAt?: number;
      shareId: string;
      workspaceId: Id<"workspaces">;
      _id: Id<"resourceShares">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "accessLevel"
      | "createdAt"
      | "createdBy"
      | "expiresAt"
      | "lastUsedAt"
      | "name"
      | "resourceId"
      | "resourceType"
      | "revokedAt"
      | "shareId"
      | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_resource: ["resourceType", "resourceId", "_creationTime"];
      by_resource_id: ["resourceId", "_creationTime"];
      by_shareId: ["shareId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  spreadsheetCellRefs: {
    document: {
      cellRef: string;
      orphan?: boolean;
      spreadsheetId: Id<"spreadsheets">;
      stableRef: string;
      updatedAt: number;
      values: string;
      _id: Id<"spreadsheetCellRefs">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "cellRef"
      | "orphan"
      | "spreadsheetId"
      | "stableRef"
      | "updatedAt"
      | "values";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_spreadsheet: ["spreadsheetId", "_creationTime"];
      by_spreadsheet_stableRef: ["spreadsheetId", "stableRef", "_creationTime"];
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
      by_yjsSnapshotId: ["yjsSnapshotId", "_creationTime"];
    };
    searchIndexes: {
      by_name: {
        searchField: "name";
        filterFields: "workspaceId";
      };
    };
    vectorIndexes: {};
  };
  tags: {
    document: {
      name: string;
      workspaceId: Id<"workspaces">;
      _id: Id<"tags">;
      _creationTime: number;
    };
    fieldPaths: "_creationTime" | "_id" | "name" | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_workspace: ["workspaceId", "_creationTime"];
      by_workspace_name: ["workspaceId", "name", "_creationTime"];
    };
    searchIndexes: {
      by_name: {
        searchField: "name";
        filterFields: "workspaceId";
      };
    };
    vectorIndexes: {};
  };
  taskCommentIntegrationLinks: {
    document: {
      externalAuthor: { avatarUrl: string; login: string; url: string };
      externalCommentId: string;
      externalUpdatedAt: number;
      lastSyncError?: {
        httpStatus?: number;
        message: string;
        occurredAt: number;
      };
      taskCommentId: Id<"taskComments">;
      taskIntegrationLinkId: Id<"taskIntegrationLinks">;
      _id: Id<"taskCommentIntegrationLinks">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "externalAuthor"
      | "externalAuthor.avatarUrl"
      | "externalAuthor.login"
      | "externalAuthor.url"
      | "externalCommentId"
      | "externalUpdatedAt"
      | "lastSyncError"
      | "lastSyncError.httpStatus"
      | "lastSyncError.message"
      | "lastSyncError.occurredAt"
      | "taskCommentId"
      | "taskIntegrationLinkId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_externalCommentId: ["externalCommentId", "_creationTime"];
      by_taskComment: ["taskCommentId", "_creationTime"];
      by_taskIntegrationLink: ["taskIntegrationLinkId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  taskComments: {
    document: {
      body: string;
      deleted: boolean;
      lastSyncError?: {
        httpStatus?: number;
        message: string;
        occurredAt: number;
      };
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
      | "lastSyncError"
      | "lastSyncError.httpStatus"
      | "lastSyncError.message"
      | "lastSyncError.occurredAt"
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
  taskImportJobs: {
    document: {
      completedAt?: number;
      creatorId: Id<"users">;
      errorMessage?: string;
      failedRows: number;
      numberRangeStart: number;
      processedRows: number;
      projectId: Id<"projects">;
      projectIntegrationLinkId?: Id<"projectIntegrationLinks">;
      rows: Array<any>;
      sourceType?: "csv" | "github_integration";
      status: "queued" | "running" | "completed" | "failed";
      totalRows: number;
      workspaceId: Id<"workspaces">;
      _id: Id<"taskImportJobs">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "completedAt"
      | "creatorId"
      | "errorMessage"
      | "failedRows"
      | "numberRangeStart"
      | "processedRows"
      | "projectId"
      | "projectIntegrationLinkId"
      | "rows"
      | "sourceType"
      | "status"
      | "totalRows"
      | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_project: ["projectId", "_creationTime"];
      by_project_status: ["projectId", "status", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  taskIntegrationLinks: {
    document: {
      branchName?: string;
      descriptionEdited?: boolean;
      descriptionLastSyncedAt?: number;
      externalAssigneeLogins?: Array<string>;
      externalAssignees?: Array<{
        avatarUrl: string;
        login: string;
        url: string;
      }>;
      externalAuthor: { avatarUrl: string; login: string; url: string };
      externalClosedBy?: { avatarUrl: string; login: string; url: string };
      externalDeletedAt?: number;
      externalIssueId: string;
      externalLabels?: Array<string>;
      externalState?: "open" | "closed";
      externalStateReason?: "completed" | "not_planned";
      externalUpdatedAt: number;
      initialBodyMarkdown?: string;
      lastSyncError?: {
        httpStatus?: number;
        message: string;
        occurredAt: number;
      };
      projectIntegrationLinkId: Id<"projectIntegrationLinks">;
      seedStatus?: "pending" | "seeded" | "skipped" | "failed";
      taskId: Id<"tasks">;
      _id: Id<"taskIntegrationLinks">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "branchName"
      | "descriptionEdited"
      | "descriptionLastSyncedAt"
      | "externalAssigneeLogins"
      | "externalAssignees"
      | "externalAuthor"
      | "externalAuthor.avatarUrl"
      | "externalAuthor.login"
      | "externalAuthor.url"
      | "externalClosedBy"
      | "externalClosedBy.avatarUrl"
      | "externalClosedBy.login"
      | "externalClosedBy.url"
      | "externalDeletedAt"
      | "externalIssueId"
      | "externalLabels"
      | "externalState"
      | "externalStateReason"
      | "externalUpdatedAt"
      | "initialBodyMarkdown"
      | "lastSyncError"
      | "lastSyncError.httpStatus"
      | "lastSyncError.message"
      | "lastSyncError.occurredAt"
      | "projectIntegrationLinkId"
      | "seedStatus"
      | "taskId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_link_externalIssueId: [
        "projectIntegrationLinkId",
        "externalIssueId",
        "_creationTime",
      ];
      by_task: ["taskId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  taskPullRequestLinks: {
    document: {
      pullRequestId: Id<"pullRequests">;
      taskId: Id<"tasks">;
      _id: Id<"taskPullRequestLinks">;
      _creationTime: number;
    };
    fieldPaths: "_creationTime" | "_id" | "pullRequestId" | "taskId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_pullRequest: ["pullRequestId", "_creationTime"];
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
      externalAssignees?: Array<{
        avatarUrl: string;
        login: string;
        url: string;
      }>;
      externalRefFrozen?: {
        disconnectedAt: number;
        externalAuthor?: { avatarUrl: string; login: string; url: string };
        externalIssueId: string;
        externalRepoId: string;
        issueNumber: number;
        provider: string;
        repoFullName: string;
        url: string;
      };
      externalRefs?: Array<{
        deleted?: boolean;
        issueNumber: number;
        provider: string;
        repoFullName: string;
        url: string;
      }>;
      importJobId?: Id<"taskImportJobs">;
      labels?: Array<string>;
      number?: number;
      plannedStartDate?: string;
      position?: string;
      priority: "urgent" | "high" | "medium" | "low";
      projectId: Id<"projects">;
      pullRequestState?: "draft" | "open" | "merged" | "closed";
      startDate?: string;
      statusId: Id<"taskStatuses">;
      title: string;
      workPeriods?: Array<{ completedAt?: number; startedAt: number }>;
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
      | "externalAssignees"
      | "externalRefFrozen"
      | "externalRefFrozen.disconnectedAt"
      | "externalRefFrozen.externalAuthor"
      | "externalRefFrozen.externalAuthor.avatarUrl"
      | "externalRefFrozen.externalAuthor.login"
      | "externalRefFrozen.externalAuthor.url"
      | "externalRefFrozen.externalIssueId"
      | "externalRefFrozen.externalRepoId"
      | "externalRefFrozen.issueNumber"
      | "externalRefFrozen.provider"
      | "externalRefFrozen.repoFullName"
      | "externalRefFrozen.url"
      | "externalRefs"
      | "importJobId"
      | "labels"
      | "number"
      | "plannedStartDate"
      | "position"
      | "priority"
      | "projectId"
      | "pullRequestState"
      | "startDate"
      | "statusId"
      | "title"
      | "workPeriods"
      | "workspaceId"
      | "yjsSnapshotId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_assignee: ["assigneeId", "_creationTime"];
      by_assignee_completed: ["assigneeId", "completed", "_creationTime"];
      by_importJob: ["importJobId", "_creationTime"];
      by_project: ["projectId", "_creationTime"];
      by_project_completed: ["projectId", "completed", "_creationTime"];
      by_project_completed_assignee: [
        "projectId",
        "completed",
        "assigneeId",
        "_creationTime",
      ];
      by_project_completed_assignee_dueDate: [
        "projectId",
        "completed",
        "assigneeId",
        "dueDate",
        "_creationTime",
      ];
      by_project_completed_assignee_plannedStartDate: [
        "projectId",
        "completed",
        "assigneeId",
        "plannedStartDate",
        "_creationTime",
      ];
      by_project_completed_dueDate: [
        "projectId",
        "completed",
        "dueDate",
        "_creationTime",
      ];
      by_project_completed_plannedStartDate: [
        "projectId",
        "completed",
        "plannedStartDate",
        "_creationTime",
      ];
      by_project_completed_priority: [
        "projectId",
        "completed",
        "priority",
        "_creationTime",
      ];
      by_project_completed_priority_dueDate: [
        "projectId",
        "completed",
        "priority",
        "dueDate",
        "_creationTime",
      ];
      by_project_completed_priority_plannedStartDate: [
        "projectId",
        "completed",
        "priority",
        "plannedStartDate",
        "_creationTime",
      ];
      by_project_number: ["projectId", "number", "_creationTime"];
      by_project_status: ["projectId", "statusId", "_creationTime"];
      by_project_status_position: [
        "projectId",
        "statusId",
        "position",
        "_creationTime",
      ];
      by_workspace: ["workspaceId", "_creationTime"];
      by_workspace_completed: ["workspaceId", "completed", "_creationTime"];
      by_yjsSnapshotId: ["yjsSnapshotId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  taskStatuses: {
    document: {
      color: string;
      externalCloseReason?: "completed" | "not_planned";
      isCompleted: boolean;
      isDefault: boolean;
      isTriage?: boolean;
      name: string;
      order: number;
      pendingDeletion?: boolean;
      projectId: Id<"projects">;
      setsStartDate?: boolean;
      _id: Id<"taskStatuses">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "color"
      | "externalCloseReason"
      | "isCompleted"
      | "isDefault"
      | "isTriage"
      | "name"
      | "order"
      | "pendingDeletion"
      | "projectId"
      | "setsStartDate";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_project: ["projectId", "_creationTime"];
      by_project_isCompleted_closeReason_order: [
        "projectId",
        "isCompleted",
        "externalCloseReason",
        "order",
        "_creationTime",
      ];
      by_project_isCompleted_order: [
        "projectId",
        "isCompleted",
        "order",
        "_creationTime",
      ];
      by_project_isDefault: ["projectId", "isDefault", "_creationTime"];
      by_project_isTriage: ["projectId", "isTriage", "_creationTime"];
      by_project_order: ["projectId", "order", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  taskTags: {
    document: {
      assigneeId?: Id<"users">;
      completed: boolean;
      dueDate?: string;
      plannedStartDate?: string;
      projectId: Id<"projects">;
      tagId: Id<"tags">;
      tagName: string;
      taskId: Id<"tasks">;
      workspaceId: Id<"workspaces">;
      _id: Id<"taskTags">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "assigneeId"
      | "completed"
      | "dueDate"
      | "plannedStartDate"
      | "projectId"
      | "tagId"
      | "tagName"
      | "taskId"
      | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_project_tag_completed: [
        "projectId",
        "tagId",
        "completed",
        "_creationTime",
      ];
      by_project_tag_completed_dueDate: [
        "projectId",
        "tagId",
        "completed",
        "dueDate",
        "_creationTime",
      ];
      by_project_tag_completed_plannedStartDate: [
        "projectId",
        "tagId",
        "completed",
        "plannedStartDate",
        "_creationTime",
      ];
      by_task: ["taskId", "_creationTime"];
      by_workspace_assignee_tag_completed: [
        "workspaceId",
        "assigneeId",
        "tagId",
        "completed",
        "_creationTime",
      ];
      by_workspace_tag: ["workspaceId", "tagId", "_creationTime"];
      by_workspace_tag_completed: [
        "workspaceId",
        "tagId",
        "completed",
        "_creationTime",
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  userChannelState: {
    document: {
      channelId: Id<"channels">;
      hiddenAt?: number;
      lastReadAt?: number;
      userId: Id<"users">;
      workspaceId: Id<"workspaces">;
      _id: Id<"userChannelState">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "channelId"
      | "hiddenAt"
      | "lastReadAt"
      | "userId"
      | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_channel_user: ["channelId", "userId", "_creationTime"];
      by_workspace_user: ["workspaceId", "userId", "_creationTime"];
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
      isBot?: boolean;
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
      | "isBot"
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
  workspaceEntitlements: {
    document: {
      enabled: boolean;
      featureKey: string;
      source?: "manual" | "tier" | "plugin";
      workspaceId: Id<"workspaces">;
      _id: Id<"workspaceEntitlements">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "enabled"
      | "featureKey"
      | "source"
      | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_workspace_feature: ["workspaceId", "featureKey", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  workspaceIntegrations: {
    document: {
      accountLogin?: string;
      botUserId: Id<"users">;
      externalAccountId: string;
      externalAccountType?: "organization" | "user";
      installedBy?: Id<"users">;
      provider: string;
      workspaceId: Id<"workspaces">;
      _id: Id<"workspaceIntegrations">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "accountLogin"
      | "botUserId"
      | "externalAccountId"
      | "externalAccountType"
      | "installedBy"
      | "provider"
      | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_externalAccount: ["externalAccountId", "_creationTime"];
      by_workspace: ["workspaceId", "_creationTime"];
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
  workspaceMemberExternalIdentity: {
    document: {
      externalLogin: string;
      provider: string;
      userId: Id<"users">;
      workspaceId: Id<"workspaces">;
      _id: Id<"workspaceMemberExternalIdentity">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "externalLogin"
      | "provider"
      | "userId"
      | "workspaceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_workspace_provider_login: [
        "workspaceId",
        "provider",
        "externalLogin",
        "_creationTime",
      ];
      by_workspace_user_provider: [
        "workspaceId",
        "userId",
        "provider",
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
