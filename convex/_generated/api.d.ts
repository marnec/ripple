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
    getResourceNames: FunctionReference<
      "query",
      "public",
      {
        resourceIds: Array<
          | Id<"workspaces">
          | Id<"channels">
          | Id<"projects">
          | Id<"documents">
          | Id<"diagrams">
          | Id<"spreadsheets">
          | Id<"tasks">
          | Id<"cycles">
        >;
      },
      Record<string, string | null>
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
        email?: string;
        lastReadAt?: number;
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
  channelNotificationPreferences: {
    get: FunctionReference<
      "query",
      "public",
      { channelId: Id<"channels"> },
      {
        _creationTime: number;
        _id: Id<"channelNotificationPreferences">;
        channelId: Id<"channels">;
        chatChannelMessage: boolean;
        chatMention: boolean;
        userId: Id<"users">;
      } | null
    >;
    save: FunctionReference<
      "mutation",
      "public",
      {
        channelId: Id<"channels">;
        chatChannelMessage: boolean;
        chatMention: boolean;
      },
      null
    >;
  };
  channelReads: {
    getUnreadCounts: FunctionReference<
      "query",
      "public",
      { channelIds: Array<Id<"channels">> },
      Array<{ channelId: Id<"channels">; count: number }>
    >;
    markRead: FunctionReference<
      "mutation",
      "public",
      { channelId: Id<"channels"> },
      null
    >;
  };
  channels: {
    approveJoinRequest: FunctionReference<
      "mutation",
      "public",
      { requestId: Id<"channelJoinRequests"> },
      null
    >;
    create: FunctionReference<
      "mutation",
      "public",
      {
        name: string;
        type: "open" | "closed" | "dm";
        workspaceId: Id<"workspaces">;
      },
      Id<"channels">
    >;
    createDm: FunctionReference<
      "mutation",
      "public",
      { otherUserId: Id<"users">; workspaceId: Id<"workspaces"> },
      Id<"channels">
    >;
    denyJoinRequest: FunctionReference<
      "mutation",
      "public",
      { requestId: Id<"channelJoinRequests"> },
      null
    >;
    findDm: FunctionReference<
      "query",
      "public",
      { otherUserId: Id<"users">; workspaceId: Id<"workspaces"> },
      Id<"channels"> | null
    >;
    get: FunctionReference<
      "query",
      "public",
      { id: Id<"channels"> },
      {
        _creationTime: number;
        _id: Id<"channels">;
        name: string;
        type: "open" | "closed" | "dm";
        workspaceId: Id<"workspaces">;
      } | null
    >;
    getAccessInfo: FunctionReference<
      "query",
      "public",
      { channelId: Id<"channels"> },
      | { isMember: true }
      | {
          description?: string;
          isMember: false;
          memberCount: number;
          name: string;
          type: "closed";
        }
      | {
          isMember: false;
          participants: Array<{ name: string; userId: Id<"users"> }>;
          type: "dm";
        }
      | null
    >;
    getMyPendingRequest: FunctionReference<
      "query",
      "public",
      { channelId: Id<"channels"> },
      { _creationTime: number; _id: Id<"channelJoinRequests"> } | null
    >;
    list: FunctionReference<
      "query",
      "public",
      { workspaceId: Id<"workspaces"> },
      Array<{
        _creationTime: number;
        _id: Id<"channels">;
        name: string;
        type: "open" | "closed" | "dm";
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
        name: string;
        type: "open" | "closed" | "dm";
        workspaceId: Id<"workspaces">;
      }>
    >;
    listPendingRequestsForAdmin: FunctionReference<
      "query",
      "public",
      {},
      Array<{
        _creationTime: number;
        _id: Id<"channelJoinRequests">;
        channelId: Id<"channels">;
        channelName: string;
        userEmail?: string;
        userId: Id<"users">;
        userName: string;
        workspaceId: Id<"workspaces">;
        workspaceName: string;
      }>
    >;
    remove: FunctionReference<
      "mutation",
      "public",
      { id: Id<"channels"> },
      null
    >;
    requestJoin: FunctionReference<
      "mutation",
      "public",
      { channelId: Id<"channels"> },
      null
    >;
    search: FunctionReference<
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
        searchText?: string;
        type?: "open" | "closed" | "dm";
        workspaceId: Id<"workspaces">;
      },
      {
        continueCursor: string;
        isDone: boolean;
        page: Array<{
          _id: Id<"channels">;
          name: string;
          type: "open" | "closed" | "dm";
        }>;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
        splitCursor?: string | null;
      }
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
  cycles: {
    addTask: FunctionReference<
      "mutation",
      "public",
      { cycleId: Id<"cycles">; taskId: Id<"tasks"> },
      null
    >;
    create: FunctionReference<
      "mutation",
      "public",
      {
        description?: string;
        dueDate?: string;
        name: string;
        projectId: Id<"projects">;
        startDate?: string;
        workspaceId: Id<"workspaces">;
      },
      Id<"cycles">
    >;
    get: FunctionReference<
      "query",
      "public",
      { cycleId: Id<"cycles"> },
      {
        _creationTime: number;
        _id: Id<"cycles">;
        completedTasks: number;
        creatorId: Id<"users">;
        description?: string;
        dueDate?: string;
        name: string;
        progressPercent: number;
        projectId: Id<"projects">;
        startDate?: string;
        status: "draft" | "upcoming" | "active" | "completed";
        totalTasks: number;
        workspaceId: Id<"workspaces">;
      } | null
    >;
    listByProject: FunctionReference<
      "query",
      "public",
      { projectId: Id<"projects"> },
      Array<{
        _creationTime: number;
        _id: Id<"cycles">;
        completedTasks: number;
        creatorId: Id<"users">;
        description?: string;
        dueDate?: string;
        name: string;
        progressPercent: number;
        projectId: Id<"projects">;
        startDate?: string;
        status: "draft" | "upcoming" | "active" | "completed";
        totalTasks: number;
        workspaceId: Id<"workspaces">;
      }>
    >;
    listCycleTasks: FunctionReference<
      "query",
      "public",
      { cycleId: Id<"cycles">; hideCompleted?: boolean },
      Array<{
        _creationTime: number;
        _id: Id<"tasks">;
        assignee: {
          _creationTime: number;
          _id: Id<"users">;
          email?: string;
          emailVerificationTime?: number;
          image?: string;
          isAnonymous?: boolean;
          name?: string;
        } | null;
        assigneeId?: Id<"users">;
        completed: boolean;
        creatorId: Id<"users">;
        dueDate?: string;
        estimate?: number;
        hasBlockers: boolean;
        labels?: Array<string>;
        number?: number;
        plannedStartDate?: string;
        position?: string;
        priority: "urgent" | "high" | "medium" | "low";
        projectId: Id<"projects">;
        projectKey?: string;
        startDate?: string;
        status: {
          _creationTime: number;
          _id: Id<"taskStatuses">;
          color: string;
          isCompleted: boolean;
          isDefault: boolean;
          name: string;
          order: number;
          projectId: Id<"projects">;
          setsStartDate?: boolean;
        } | null;
        statusId: Id<"taskStatuses">;
        title: string;
        workPeriods?: Array<{ completedAt?: number; startedAt: number }>;
        workspaceId: Id<"workspaces">;
        yjsSnapshotId?: Id<"_storage">;
      }>
    >;
    listForCalendar: FunctionReference<
      "query",
      "public",
      { projectId: Id<"projects"> },
      {
        cycles: Array<{
          _creationTime: number;
          _id: Id<"cycles">;
          completedTasks: number;
          creatorId: Id<"users">;
          description?: string;
          dueDate?: string;
          name: string;
          progressPercent: number;
          projectId: Id<"projects">;
          startDate?: string;
          status: "draft" | "upcoming" | "active" | "completed";
          totalTasks: number;
          workspaceId: Id<"workspaces">;
        }>;
        taskCycleDueDatePairs: Array<{
          cycleDueDate: string;
          taskId: Id<"tasks">;
        }>;
      }
    >;
    listTaskCycleDueDates: FunctionReference<
      "query",
      "public",
      { projectId: Id<"projects"> },
      Array<{ cycleDueDate: string; taskId: Id<"tasks"> }>
    >;
    remove: FunctionReference<
      "mutation",
      "public",
      { cycleId: Id<"cycles"> },
      null
    >;
    removeTask: FunctionReference<
      "mutation",
      "public",
      { cycleId: Id<"cycles">; taskId: Id<"tasks"> },
      null
    >;
    update: FunctionReference<
      "mutation",
      "public",
      {
        cycleId: Id<"cycles">;
        description?: string | null;
        dueDate?: string | null;
        name?: string;
        startDate?: string | null;
        status?: "draft" | "upcoming" | "active" | "completed";
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
      | { status: "deleted" }
      | {
          references: Array<{
            _id: Id<"edges">;
            edgeType: string;
            projectId?: string;
            sourceId: string;
            sourceName: string;
            sourceType: string;
            workspaceId: string;
          }>;
          status: "has_references";
        }
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
        paginationOpts: {
          cursor: string | null;
          endCursor?: string | null;
          id?: number;
          maximumBytesRead?: number;
          maximumRowsRead?: number;
          numItems: number;
        };
        searchText?: string;
        tags?: Array<string>;
        workspaceId: Id<"workspaces">;
      },
      {
        continueCursor: string;
        isDone: boolean;
        page: Array<{
          _creationTime: number;
          _id: Id<"diagrams">;
          name: string;
          tags?: Array<string>;
          workspaceId: Id<"workspaces">;
          yjsSnapshotId?: Id<"_storage">;
        }>;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
        splitCursor?: string | null;
      }
    >;
    updateTags: FunctionReference<
      "mutation",
      "public",
      { id: Id<"diagrams">; tags: Array<string> },
      null
    >;
  };
  documentBlockRefs: {
    ensureBlockRef: FunctionReference<
      "mutation",
      "public",
      { blockId: string; documentId: Id<"documents"> },
      null
    >;
    getBlockRef: FunctionReference<
      "query",
      "public",
      { blockId: string; documentId: Id<"documents"> },
      { blockType: string; textContent: string; updatedAt: number } | null
    >;
    listReferencedBlockIds: FunctionReference<
      "query",
      "public",
      { documentId: Id<"documents"> },
      Array<string>
    >;
    removeBlockRef: FunctionReference<
      "mutation",
      "public",
      { blockId: string; documentId: Id<"documents"> },
      null
    >;
  };
  documentBlockRefsNode: {
    getDocumentBlocks: FunctionReference<
      "action",
      "public",
      { documentId: Id<"documents"> },
      Array<{ blockId: string; level?: number; text: string; type: string }>
    >;
  };
  documents: {
    create: FunctionReference<
      "mutation",
      "public",
      { name?: string; workspaceId: Id<"workspaces"> },
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
    reportMention: FunctionReference<
      "mutation",
      "public",
      { documentId: Id<"documents">; mentionedUserIds: Array<Id<"users">> },
      null
    >;
    search: FunctionReference<
      "query",
      "public",
      {
        isFavorite?: boolean;
        paginationOpts: {
          cursor: string | null;
          endCursor?: string | null;
          id?: number;
          maximumBytesRead?: number;
          maximumRowsRead?: number;
          numItems: number;
        };
        searchText?: string;
        tags?: Array<string>;
        workspaceId: Id<"workspaces">;
      },
      {
        continueCursor: string;
        isDone: boolean;
        page: Array<{
          _creationTime: number;
          _id: Id<"documents">;
          name: string;
          tags?: Array<string>;
          workspaceId: Id<"workspaces">;
          yjsSnapshotId?: Id<"_storage">;
        }>;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
        splitCursor?: string | null;
      }
    >;
    updateTags: FunctionReference<
      "mutation",
      "public",
      { id: Id<"documents">; tags: Array<string> },
      null
    >;
  };
  edges: {
    createEdge: FunctionReference<
      "mutation",
      "public",
      {
        dependsOnTaskId: Id<"tasks">;
        taskId: Id<"tasks">;
        type: "blocks" | "relates_to";
      },
      Id<"edges">
    >;
    getBacklinks: FunctionReference<
      "query",
      "public",
      { targetId: string; workspaceId: Id<"workspaces"> },
      Array<{
        _id: Id<"edges">;
        edgeType: string;
        projectId?: string;
        sourceId: string;
        sourceName: string;
        sourceType: string;
        workspaceId: string;
      }>
    >;
    getNodeLabel: FunctionReference<
      "query",
      "public",
      { id: string; type: string },
      string | null
    >;
    getWorkspaceGraph: FunctionReference<
      "query",
      "public",
      { workspaceId: Id<"workspaces"> },
      {
        links: Array<{ edgeType: string; source: string; target: string }>;
        nodes: Array<{
          groupId?: string;
          id: string;
          name?: string;
          type: string;
        }>;
      }
    >;
    listByTask: FunctionReference<
      "query",
      "public",
      { taskId: Id<"tasks"> },
      {
        blockedBy: Array<{
          edgeId: Id<"edges">;
          task: {
            _id: Id<"tasks">;
            completed: boolean;
            number?: number;
            projectKey?: string;
            title: string;
          };
        }>;
        blocks: Array<{
          edgeId: Id<"edges">;
          task: {
            _id: Id<"tasks">;
            completed: boolean;
            number?: number;
            projectKey?: string;
            title: string;
          };
        }>;
        relatesTo: Array<{
          edgeId: Id<"edges">;
          task: {
            _id: Id<"tasks">;
            completed: boolean;
            number?: number;
            projectKey?: string;
            title: string;
          };
        }>;
      }
    >;
    removeEdge: FunctionReference<
      "mutation",
      "public",
      { edgeId: Id<"edges"> },
      null
    >;
    syncEdges: FunctionReference<
      "mutation",
      "public",
      {
        references: Array<{
          targetId: string;
          targetType: "diagram" | "spreadsheet" | "document";
        }>;
        sourceId: string;
        sourceType: "document" | "task";
        workspaceId: Id<"workspaces">;
      },
      null
    >;
    syncMentionEdges: FunctionReference<
      "mutation",
      "public",
      {
        mentionedUserIds: Array<string>;
        sourceId: string;
        sourceType: "document" | "task";
        workspaceId: Id<"workspaces">;
      },
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
    listAllIdsForWorkspace: FunctionReference<
      "query",
      "public",
      { workspaceId: Id<"workspaces"> },
      {
        diagram: Array<string>;
        document: Array<string>;
        project: Array<string>;
        spreadsheet: Array<string>;
      }
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
      {
        continueCursor: string;
        isDone: boolean;
        page: Array<{
          _id: Id<"favorites">;
          favoritedAt: number;
          name: string;
          resourceId: string;
          resourceType: "document" | "diagram" | "spreadsheet" | "project";
        }>;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
        splitCursor?: string | null;
      }
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
      Array<{
        _id: Id<"favorites">;
        favoritedAt: number;
        name: string;
        resourceId: string;
        resourceType: "document" | "diagram" | "spreadsheet" | "project";
      }>
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
    listForMessages: FunctionReference<
      "query",
      "public",
      { messageIds: Array<Id<"messages">> },
      Record<
        string,
        Array<{
          count: number;
          currentUserReacted: boolean;
          emoji: string;
          emojiNative: string;
          userIds: Array<string>;
        }>
      >
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
          authorImage?: string;
          body: string;
          channelId: Id<"channels">;
          deleted: boolean;
          isomorphicId: string;
          mentionedProjects: Record<string, { color: string; name: string }>;
          mentionedResources: Record<
            string,
            { name: string; type: "document" | "diagram" | "spreadsheet" }
          >;
          mentionedTasks: Record<
            string,
            { projectId: string; statusColor?: string; title: string }
          >;
          mentionedUsers: Record<
            string,
            { email?: string | null; image?: string; name: string | null }
          >;
          plainText: string;
          replyTo: null | {
            author: string;
            deleted: boolean;
            imageUrl?: string;
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
          authorImage?: string;
          body: string;
          channelId: Id<"channels">;
          deleted: boolean;
          isomorphicId: string;
          mentionedProjects: Record<string, { color: string; name: string }>;
          mentionedResources: Record<
            string,
            { name: string; type: "document" | "diagram" | "spreadsheet" }
          >;
          mentionedTasks: Record<
            string,
            { projectId: string; statusColor?: string; title: string }
          >;
          mentionedUsers: Record<
            string,
            { email?: string | null; image?: string; name: string | null }
          >;
          plainText: string;
          replyTo: null | {
            author: string;
            deleted: boolean;
            imageUrl?: string;
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
        authorImage?: string;
        body: string;
        channelId: Id<"channels">;
        deleted: boolean;
        isomorphicId: string;
        mentionedProjects: Record<string, { color: string; name: string }>;
        mentionedResources: Record<
          string,
          { name: string; type: "document" | "diagram" | "spreadsheet" }
        >;
        mentionedTasks: Record<
          string,
          { projectId: string; statusColor?: string; title: string }
        >;
        mentionedUsers: Record<
          string,
          { email?: string | null; image?: string; name: string | null }
        >;
        plainText: string;
        replyTo: null | {
          author: string;
          deleted: boolean;
          imageUrl?: string;
          plainText: string;
        };
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
  nodes: {
    listByWorkspace: FunctionReference<
      "query",
      "public",
      { workspaceId: Id<"workspaces"> },
      Array<{
        name: string;
        resourceId: string;
        resourceType: string;
        tags: Array<string>;
      }>
    >;
    search: FunctionReference<
      "query",
      "public",
      {
        resourceType?:
          | "document"
          | "diagram"
          | "spreadsheet"
          | "project"
          | "channel"
          | "task";
        searchText: string;
        workspaceId: Id<"workspaces">;
      },
      Array<{
        name: string;
        resourceId: string;
        resourceType: string;
        tags: Array<string>;
      }>
    >;
  };
  notificationPreferences: {
    get: FunctionReference<
      "query",
      "public",
      {},
      {
        _creationTime: number;
        _id: Id<"notificationPreferences">;
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
      } | null
    >;
    save: FunctionReference<
      "mutation",
      "public",
      {
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
        projectCreated: boolean;
        projectDeleted: boolean;
        spreadsheetCreated: boolean;
        spreadsheetDeleted: boolean;
        taskAssigned: boolean;
        taskComment: boolean;
        taskCommentMention: boolean;
        taskDescriptionMention: boolean;
        taskStatusChange: boolean;
      },
      null
    >;
  };
  projectNotificationPreferences: {
    get: FunctionReference<
      "query",
      "public",
      { projectId: Id<"projects"> },
      {
        _creationTime: number;
        _id: Id<"projectNotificationPreferences">;
        projectId: Id<"projects">;
        taskAssigned: boolean;
        taskComment: boolean;
        taskCommentMention: boolean;
        taskDescriptionMention: boolean;
        taskStatusChange: boolean;
        userId: Id<"users">;
      } | null
    >;
    save: FunctionReference<
      "mutation",
      "public",
      {
        projectId: Id<"projects">;
        taskAssigned: boolean;
        taskComment: boolean;
        taskCommentMention: boolean;
        taskDescriptionMention: boolean;
        taskStatusChange: boolean;
      },
      null
    >;
  };
  projects: {
    create: FunctionReference<
      "mutation",
      "public",
      {
        color: string;
        key?: string;
        name: string;
        workspaceId: Id<"workspaces">;
      },
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
        paginationOpts: {
          cursor: string | null;
          endCursor?: string | null;
          id?: number;
          maximumBytesRead?: number;
          maximumRowsRead?: number;
          numItems: number;
        };
        searchText?: string;
        workspaceId: Id<"workspaces">;
      },
      {
        continueCursor: string;
        isDone: boolean;
        page: Array<{
          _creationTime: number;
          _id: Id<"projects">;
          color: string;
          creatorId: Id<"users">;
          description?: string;
          key?: string;
          name: string;
          taskCounter?: number;
          workspaceId: Id<"workspaces">;
        }>;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
        splitCursor?: string | null;
      }
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
      },
      null
    >;
  };
  pushSubscription: {
    registerSubscription: FunctionReference<
      "mutation",
      "public",
      {
        device: string;
        endpoint: string;
        expirationTime: number | null;
        keys: { auth: string; p256dh: string };
      },
      null
    >;
    unregisterSubscription: FunctionReference<
      "mutation",
      "public",
      { endpoint: string },
      null
    >;
  };
  recentActivity: {
    listRecent: FunctionReference<
      "query",
      "public",
      { limit?: number; workspaceId: Id<"workspaces"> },
      Array<{
        _creationTime: number;
        _id: Id<"recentActivity">;
        deleted: boolean;
        resourceId: string;
        resourceName: string;
        resourceType:
          | "channel"
          | "document"
          | "diagram"
          | "spreadsheet"
          | "project";
        visitedAt: number;
      }>
    >;
    recordVisit: FunctionReference<
      "mutation",
      "public",
      {
        resourceId: string;
        resourceName: string;
        resourceType:
          | "channel"
          | "document"
          | "diagram"
          | "spreadsheet"
          | "project";
        workspaceId: Id<"workspaces">;
      },
      null
    >;
  };
  shares: {
    createShare: FunctionReference<
      "mutation",
      "public",
      {
        accessLevel: "view" | "edit" | "join";
        expiresAt?: number;
        resourceId: string;
        resourceType: "document" | "diagram" | "spreadsheet" | "channel";
      },
      { shareId: string }
    >;
    getGuestCallToken: FunctionReference<
      "action",
      "public",
      { guestName: string; guestSub: string; shareId: string },
      {
        authToken: string;
        channelId: Id<"channels">;
        guestSub: string;
        meetingId: string;
      }
    >;
    getGuestCollaborationToken: FunctionReference<
      "action",
      "public",
      { guestName: string; guestSub: string; shareId: string },
      { guestSub: string; roomId: string; token: string }
    >;
    getShareInfo: FunctionReference<
      "query",
      "public",
      { shareId: string },
      {
        accessLevel?: "view" | "edit" | "join";
        resourceId?: string;
        resourceName?: string;
        resourceType?: "document" | "diagram" | "spreadsheet" | "channel";
        status: "active" | "expired" | "revoked" | "not_found";
        workspaceName?: string;
      }
    >;
    listSharesForResource: FunctionReference<
      "query",
      "public",
      {
        resourceId: string;
        resourceType: "document" | "diagram" | "spreadsheet" | "channel";
      },
      Array<{
        _creationTime: number;
        _id: Id<"resourceShares">;
        accessLevel: "view" | "edit" | "join";
        createdAt: number;
        createdBy: Id<"users">;
        expiresAt?: number;
        lastUsedAt?: number;
        resourceId: string;
        resourceType: "document" | "diagram" | "spreadsheet" | "channel";
        revokedAt?: number;
        shareId: string;
        workspaceId: Id<"workspaces">;
      }>
    >;
    revokeShare: FunctionReference<
      "mutation",
      "public",
      { shareId: string },
      null
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
      { updatedAt: number; values: Array<Array<string>> } | null
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
      | { status: "deleted" }
      | {
          references: Array<{
            _id: Id<"edges">;
            edgeType: string;
            projectId?: string;
            sourceId: string;
            sourceName: string;
            sourceType: string;
            workspaceId: string;
          }>;
          status: "has_references";
        }
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
        paginationOpts: {
          cursor: string | null;
          endCursor?: string | null;
          id?: number;
          maximumBytesRead?: number;
          maximumRowsRead?: number;
          numItems: number;
        };
        searchText?: string;
        tags?: Array<string>;
        workspaceId: Id<"workspaces">;
      },
      {
        continueCursor: string;
        isDone: boolean;
        page: Array<{
          _creationTime: number;
          _id: Id<"spreadsheets">;
          name: string;
          tags?: Array<string>;
          workspaceId: Id<"workspaces">;
          yjsSnapshotId?: Id<"_storage">;
        }>;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
        splitCursor?: string | null;
      }
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
  tagSync: {
    createTag: FunctionReference<
      "mutation",
      "public",
      { name: string; workspaceId: Id<"workspaces"> },
      Id<"tags">
    >;
    deleteTag: FunctionReference<
      "mutation",
      "public",
      { tagId: Id<"tags"> },
      null
    >;
  };
  taskActivity: {
    timeline: FunctionReference<
      "query",
      "public",
      { taskId: Id<"tasks"> },
      Array<
        | {
            _creationTime: number;
            _id: string;
            kind: "activity";
            newValue?: string;
            oldValue?: string;
            type: string;
            userId: string;
            userImage?: string;
            userName: string;
          }
        | {
            _creationTime: number;
            _id: Id<"taskComments">;
            body: string;
            commentId: Id<"taskComments">;
            kind: "comment";
            userId: Id<"users">;
            userImage?: string;
            userName: string;
          }
      >
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
  tasks: {
    create: FunctionReference<
      "mutation",
      "public",
      {
        assigneeId?: Id<"users">;
        dueDate?: string;
        estimate?: number;
        labels?: Array<string>;
        plannedStartDate?: string;
        position?: string;
        priority?: "urgent" | "high" | "medium" | "low";
        projectId: Id<"projects">;
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
      {
        _creationTime: number;
        _id: Id<"tasks">;
        assignee: {
          _creationTime: number;
          _id: Id<"users">;
          email?: string;
          emailVerificationTime?: number;
          image?: string;
          isAnonymous?: boolean;
          name?: string;
        } | null;
        assigneeId?: Id<"users">;
        completed: boolean;
        creatorId: Id<"users">;
        dueDate?: string;
        estimate?: number;
        hasBlockers: boolean;
        labels?: Array<string>;
        number?: number;
        plannedStartDate?: string;
        position?: string;
        priority: "urgent" | "high" | "medium" | "low";
        projectId: Id<"projects">;
        projectKey?: string;
        status: {
          _creationTime: number;
          _id: Id<"taskStatuses">;
          color: string;
          isCompleted: boolean;
          isDefault: boolean;
          name: string;
          order: number;
          projectId: Id<"projects">;
          setsStartDate?: boolean;
        } | null;
        statusId: Id<"taskStatuses">;
        title: string;
        workPeriods?: Array<{ completedAt?: number; startedAt: number }>;
        workspaceId: Id<"workspaces">;
        yjsSnapshotId?: Id<"_storage">;
      } | null
    >;
    hasAnyTasks: FunctionReference<
      "query",
      "public",
      { projectId: Id<"projects"> },
      boolean
    >;
    listByAssignee: FunctionReference<
      "query",
      "public",
      {
        completed: boolean;
        tagNames?: Array<string>;
        workspaceId: Id<"workspaces">;
      },
      Array<{
        _creationTime: number;
        _id: Id<"tasks">;
        assignee: {
          _creationTime: number;
          _id: Id<"users">;
          email?: string;
          emailVerificationTime?: number;
          image?: string;
          isAnonymous?: boolean;
          name?: string;
        } | null;
        assigneeId?: Id<"users">;
        completed: boolean;
        creatorId: Id<"users">;
        dueDate?: string;
        estimate?: number;
        labels?: Array<string>;
        number?: number;
        plannedStartDate?: string;
        position?: string;
        priority: "urgent" | "high" | "medium" | "low";
        project: {
          _creationTime: number;
          _id: Id<"projects">;
          color: string;
          creatorId: Id<"users">;
          description?: string;
          key?: string;
          name: string;
          taskCounter?: number;
          workspaceId: Id<"workspaces">;
        } | null;
        projectId: Id<"projects">;
        projectKey?: string;
        status: {
          _creationTime: number;
          _id: Id<"taskStatuses">;
          color: string;
          isCompleted: boolean;
          isDefault: boolean;
          name: string;
          order: number;
          projectId: Id<"projects">;
          setsStartDate?: boolean;
        } | null;
        statusId: Id<"taskStatuses">;
        title: string;
        workPeriods?: Array<{ completedAt?: number; startedAt: number }>;
        workspaceId: Id<"workspaces">;
        yjsSnapshotId?: Id<"_storage">;
      }>
    >;
    listByProject: FunctionReference<
      "query",
      "public",
      {
        completed: boolean;
        limit?: number;
        projectId: Id<"projects">;
        tagNames?: Array<string>;
      },
      Array<{
        _creationTime: number;
        _id: Id<"tasks">;
        assignee: {
          _creationTime: number;
          _id: Id<"users">;
          email?: string;
          emailVerificationTime?: number;
          image?: string;
          isAnonymous?: boolean;
          name?: string;
        } | null;
        assigneeId?: Id<"users">;
        completed: boolean;
        creatorId: Id<"users">;
        dueDate?: string;
        estimate?: number;
        hasBlockers: boolean;
        labels?: Array<string>;
        number?: number;
        plannedStartDate?: string;
        position?: string;
        priority: "urgent" | "high" | "medium" | "low";
        projectId: Id<"projects">;
        projectKey?: string;
        status: {
          _creationTime: number;
          _id: Id<"taskStatuses">;
          color: string;
          isCompleted: boolean;
          isDefault: boolean;
          name: string;
          order: number;
          projectId: Id<"projects">;
          setsStartDate?: boolean;
        } | null;
        statusId: Id<"taskStatuses">;
        title: string;
        workPeriods?: Array<{ completedAt?: number; startedAt: number }>;
        workspaceId: Id<"workspaces">;
        yjsSnapshotId?: Id<"_storage">;
      }>
    >;
    listByWorkspace: FunctionReference<
      "query",
      "public",
      {
        completed: boolean;
        tagNames?: Array<string>;
        workspaceId: Id<"workspaces">;
      },
      Array<{
        _creationTime: number;
        _id: Id<"tasks">;
        assigneeId?: Id<"users">;
        completed: boolean;
        creatorId: Id<"users">;
        dueDate?: string;
        estimate?: number;
        labels?: Array<string>;
        number?: number;
        plannedStartDate?: string;
        position?: string;
        priority: "urgent" | "high" | "medium" | "low";
        projectId: Id<"projects">;
        projectKey?: string;
        status: { color: string; isCompleted: boolean; name: string } | null;
        statusId: Id<"taskStatuses">;
        title: string;
        workPeriods?: Array<{ completedAt?: number; startedAt: number }>;
        workspaceId: Id<"workspaces">;
        yjsSnapshotId?: Id<"_storage">;
      }>
    >;
    listCompletedByProject: FunctionReference<
      "query",
      "public",
      {
        filter?:
          | { kind: "tag"; tagName: string }
          | { assigneeId: Id<"users">; kind: "assignee" }
          | {
              kind: "priority";
              priority: "urgent" | "high" | "medium" | "low";
            };
        paginationOpts: {
          cursor: string | null;
          endCursor?: string | null;
          id?: number;
          maximumBytesRead?: number;
          maximumRowsRead?: number;
          numItems: number;
        };
        projectId: Id<"projects">;
        sort?: "created" | "dueDate" | "plannedStartDate";
      },
      {
        continueCursor: string;
        isDone: boolean;
        page: Array<{
          _creationTime: number;
          _id: Id<"tasks">;
          assignee: {
            _creationTime: number;
            _id: Id<"users">;
            email?: string;
            emailVerificationTime?: number;
            image?: string;
            isAnonymous?: boolean;
            name?: string;
          } | null;
          assigneeId?: Id<"users">;
          completed: boolean;
          creatorId: Id<"users">;
          dueDate?: string;
          estimate?: number;
          hasBlockers: boolean;
          labels?: Array<string>;
          number?: number;
          plannedStartDate?: string;
          position?: string;
          priority: "urgent" | "high" | "medium" | "low";
          projectId: Id<"projects">;
          projectKey?: string;
          status: {
            _creationTime: number;
            _id: Id<"taskStatuses">;
            color: string;
            isCompleted: boolean;
            isDefault: boolean;
            name: string;
            order: number;
            projectId: Id<"projects">;
            setsStartDate?: boolean;
          } | null;
          statusId: Id<"taskStatuses">;
          title: string;
          workPeriods?: Array<{ completedAt?: number; startedAt: number }>;
          workspaceId: Id<"workspaces">;
          yjsSnapshotId?: Id<"_storage">;
        }>;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
        splitCursor?: string | null;
      }
    >;
    listUnscheduled: FunctionReference<
      "query",
      "public",
      { projectId: Id<"projects"> },
      Array<{
        _creationTime: number;
        _id: Id<"tasks">;
        assignee: {
          _creationTime: number;
          _id: Id<"users">;
          email?: string;
          emailVerificationTime?: number;
          image?: string;
          isAnonymous?: boolean;
          name?: string;
        } | null;
        assigneeId?: Id<"users">;
        completed: boolean;
        creatorId: Id<"users">;
        dueDate?: string;
        estimate?: number;
        hasBlockers: boolean;
        labels?: Array<string>;
        number?: number;
        plannedStartDate?: string;
        position?: string;
        priority: "urgent" | "high" | "medium" | "low";
        projectId: Id<"projects">;
        projectKey?: string;
        status: {
          _creationTime: number;
          _id: Id<"taskStatuses">;
          color: string;
          isCompleted: boolean;
          isDefault: boolean;
          name: string;
          order: number;
          projectId: Id<"projects">;
          setsStartDate?: boolean;
        } | null;
        statusId: Id<"taskStatuses">;
        title: string;
        workPeriods?: Array<{ completedAt?: number; startedAt: number }>;
        workspaceId: Id<"workspaces">;
        yjsSnapshotId?: Id<"_storage">;
      }>
    >;
    notifyDescriptionMentions: FunctionReference<
      "mutation",
      "public",
      { mentionedUserIds: Array<Id<"users">>; taskId: Id<"tasks"> },
      null
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
        plannedStartDate?: string | null;
        position?: string;
        priority?: "urgent" | "high" | "medium" | "low";
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
      Array<{
        _creationTime: number;
        _id: Id<"taskStatuses">;
        color: string;
        isCompleted: boolean;
        isDefault: boolean;
        name: string;
        order: number;
        projectId: Id<"projects">;
        setsStartDate?: boolean;
      }>
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
        isCompleted?: boolean;
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
  version: {
    get: FunctionReference<"query", "public", {}, number | null>;
    set: FunctionReference<"mutation", "public", {}, null>;
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
    changeRole: FunctionReference<
      "mutation",
      "public",
      {
        role: "admin" | "member";
        targetUserId: Id<"users">;
        workspaceId: Id<"workspaces">;
      },
      null
    >;
    leave: FunctionReference<
      "mutation",
      "public",
      { workspaceId: Id<"workspaces"> },
      null
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
    membersWithRoles: FunctionReference<
      "query",
      "public",
      { workspaceId: Id<"workspaces"> },
      Array<{
        email?: string;
        image?: string;
        joinedAt: number;
        membershipId: Id<"workspaceMembers">;
        name: string;
        role: "admin" | "member";
        userId: Id<"users">;
      }>
    >;
    myRole: FunctionReference<
      "query",
      "public",
      { workspaceId: Id<"workspaces"> },
      "admin" | "member" | null
    >;
    remove: FunctionReference<
      "mutation",
      "public",
      { targetUserId: Id<"users">; workspaceId: Id<"workspaces"> },
      null
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
    overview: FunctionReference<
      "query",
      "public",
      { workspaceId: Id<"workspaces"> },
      {
        channels: number;
        diagrams: number;
        documents: number;
        members: number;
        projects: number;
        spreadsheets: number;
      }
    >;
    update: FunctionReference<
      "mutation",
      "public",
      { description?: string; id: Id<"workspaces">; name: string },
      null
    >;
  };
  workspaceSidebarData: {
    get: FunctionReference<
      "query",
      "public",
      { workspaceId: Id<"workspaces"> },
      {
        channels: Array<{
          _creationTime: number;
          _id: Id<"channels">;
          name: string;
          type: "open" | "closed" | "dm";
          workspaceId: Id<"workspaces">;
        }>;
        diagrams: Array<{
          _creationTime: number;
          _id: Id<"diagrams">;
          name: string;
          tags?: Array<string>;
        }>;
        documents: Array<{
          _creationTime: number;
          _id: Id<"documents">;
          name: string;
          tags?: Array<string>;
        }>;
        projects: Array<{
          _creationTime: number;
          _id: Id<"projects">;
          color: string;
          key?: string;
          name: string;
        }>;
        spreadsheets: Array<{
          _creationTime: number;
          _id: Id<"spreadsheets">;
          name: string;
          tags?: Array<string>;
        }>;
      }
    >;
  };
  workspaceTimeline: {
    list: FunctionReference<
      "query",
      "public",
      {
        limit?: number;
        resourceTypes?: Array<string>;
        workspaceId: Id<"workspaces">;
      },
      Array<{
        _id: string;
        action: string;
        actorImage?: string;
        actorName: string;
        cascadeSummary?: string;
        newValue?: string;
        oldValue?: string;
        resourceName?: string;
        resourceType?: string;
        timestamp: number;
      }>
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
      {
        _creationTime: number;
        _id: Id<"callSessions">;
        active: boolean;
        channelId: Id<"channels">;
        cloudflareMeetingId: string;
      } | null
    >;
  };
  cascadeDelete: {
    _batchCascadeOnComplete: FunctionReference<
      "mutation",
      "internal",
      { context?: string; status: string; summary: string },
      null
    >;
    _cascadeBatchHandler: FunctionReference<
      "mutation",
      "internal",
      { jobId: string; targets: Array<{ id: string; table: string }> },
      any
    >;
  };
  channelNotificationPreferences: {
    getForUsersInChannel: FunctionReference<
      "query",
      "internal",
      { channelId: Id<"channels">; userIds: Array<Id<"users">> },
      Array<{
        _creationTime: number;
        _id: Id<"channelNotificationPreferences">;
        channelId: Id<"channels">;
        chatChannelMessage: boolean;
        chatMention: boolean;
        userId: Id<"users">;
      } | null>
    >;
    removeByChannel: FunctionReference<
      "mutation",
      "internal",
      { channelId: Id<"channels"> },
      null
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
        name: string;
        type: "open" | "closed" | "dm";
        workspaceId: Id<"workspaces">;
      } | null
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
    getUserInfo: FunctionReference<
      "query",
      "internal",
      { userId: Id<"users"> },
      { userId: Id<"users">; userImage?: string; userName?: string }
    >;
  };
  documentBlockRefs: {
    checkMembership: FunctionReference<
      "query",
      "internal",
      { userId: Id<"users">; workspaceId: Id<"workspaces"> },
      boolean
    >;
    getDocumentInternal: FunctionReference<
      "query",
      "internal",
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
    getReferencedBlockRefs: FunctionReference<
      "query",
      "internal",
      { documentId: Id<"documents"> },
      Array<{ blockId: string }>
    >;
    removeAllForDocument: FunctionReference<
      "mutation",
      "internal",
      { documentId: Id<"documents"> },
      null
    >;
    upsertBlockContent: FunctionReference<
      "mutation",
      "internal",
      {
        documentId: Id<"documents">;
        updates: Array<{
          blockId: string;
          blockType: string;
          textContent: string;
        }>;
      },
      null
    >;
  };
  documentBlockRefsNode: {
    populateFromSnapshot: FunctionReference<
      "action",
      "internal",
      { blockId: string; documentId: Id<"documents"> },
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
      null
    >;
  };
  migrations: {
    backfillAuditScope: FunctionReference<
      "mutation",
      "internal",
      { cursor?: string },
      {
        cursor: string | null;
        isDone: boolean;
        patched: number;
        skipped: number;
      }
    >;
    backfillChannelAggregates: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillChannelMemberDenormalized: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillChannelMentionEdges: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillChannelNodes: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillDiagramAggregates: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillDiagramNodes: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillDiagramTags: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillDocumentAggregates: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillDocumentNodes: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillDocumentTags: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillEdgeNodeIds: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillMemberAggregates: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillNotificationSubscriptions: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillProjectAggregates: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillProjectNodes: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillSpreadsheetAggregates: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillSpreadsheetNodes: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillSpreadsheetTags: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillTaskAggregates: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillTaskBelongsToEdges: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillTaskNodes: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillTaskTagsAssigneeId: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillTaskTagsSortFields: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillUserNodes: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    cleanupProjectEntityTags: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    cleanupProjectTagsField: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    migrateAuditActionPrefix: FunctionReference<
      "mutation",
      "internal",
      { cursor?: string },
      {
        cursor: string | null;
        isDone: boolean;
        migrated: number;
        scanned: number;
      }
    >;
    migrateChannelIsPublicToType: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    migrateTaskStatusesToProject: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
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
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    runAll: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    runBackfillChannelMemberDenormalized: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    runChannelTypeMigration: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    stripChannelRoleCount: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
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
        oneBatchOnly?: boolean;
        reset?: boolean;
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
        oneBatchOnly?: boolean;
        reset?: boolean;
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
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    stripEdgeGroupId: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    stripMessageEdges: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
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
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    stripTaskStartDate: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
  };
  notificationDelivery: {
    getFilteredSubscriptions: FunctionReference<
      "query",
      "internal",
      { category: string; recipientIds: Array<string>; resourceId?: string },
      Array<{
        endpoint: string;
        expirationTime: number | null;
        keys: { auth: string; p256dh: string };
      }>
    >;
    getSubscribedUserIds: FunctionReference<
      "query",
      "internal",
      { category: string; excludeUserId?: string; scope: string },
      Array<string>
    >;
    getUserPushSubscriptions: FunctionReference<
      "query",
      "internal",
      { userIds: Array<string> },
      Array<{
        endpoint: string;
        expirationTime: number | null;
        keys: { auth: string; p256dh: string };
      }>
    >;
  };
  notificationPreferences: {
    getForUser: FunctionReference<
      "query",
      "internal",
      { userId: Id<"users"> },
      {
        _creationTime: number;
        _id: Id<"notificationPreferences">;
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
      } | null
    >;
    getForUsers: FunctionReference<
      "query",
      "internal",
      { userIds: Array<Id<"users">> },
      Array<{
        _creationTime: number;
        _id: Id<"notificationPreferences">;
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
      } | null>
    >;
  };
  notifications: {
    deliverPush: FunctionReference<
      "action",
      "internal",
      {
        body: string;
        category: string;
        recipientIds?: Array<string>;
        resourceId?: string;
        scope?: string;
        senderId: Id<"users">;
        title: string;
        url: string;
      },
      null
    >;
  };
  notificationSubscriptionJobs: {
    channelMadePrivate: FunctionReference<
      "mutation",
      "internal",
      { channelId: Id<"channels"> },
      null
    >;
    channelMadePublic: FunctionReference<
      "mutation",
      "internal",
      { channelId: Id<"channels">; workspaceId: Id<"workspaces"> },
      null
    >;
    globalPreferencesChanged: FunctionReference<
      "mutation",
      "internal",
      { newPrefs: any; oldPrefs?: any; userId: Id<"users"> },
      null
    >;
    memberJoined: FunctionReference<
      "mutation",
      "internal",
      { userId: Id<"users">; workspaceId: Id<"workspaces"> },
      null
    >;
    memberLeft: FunctionReference<
      "mutation",
      "internal",
      { userId: Id<"users">; workspaceId: Id<"workspaces"> },
      null
    >;
    publicChannelCreated: FunctionReference<
      "mutation",
      "internal",
      { channelId: Id<"channels">; workspaceId: Id<"workspaces"> },
      null
    >;
  };
  projectNotificationPreferences: {
    getForUsersInProject: FunctionReference<
      "query",
      "internal",
      { projectId: Id<"projects">; userIds: Array<Id<"users">> },
      Array<{
        _creationTime: number;
        _id: Id<"projectNotificationPreferences">;
        projectId: Id<"projects">;
        taskAssigned: boolean;
        taskComment: boolean;
        taskCommentMention: boolean;
        taskDescriptionMention: boolean;
        taskStatusChange: boolean;
        userId: Id<"users">;
      } | null>
    >;
    removeByProject: FunctionReference<
      "mutation",
      "internal",
      { projectId: Id<"projects"> },
      null
    >;
  };
  pushSubscription: {
    removeStaleEndpoints: FunctionReference<
      "mutation",
      "internal",
      { endpoints: Array<string> },
      null
    >;
    usersSubscriptions: FunctionReference<
      "query",
      "internal",
      { usersIds: Array<Id<"users">> },
      Array<{
        _creationTime: number;
        _id: Id<"pushSubscriptions">;
        device: string;
        endpoint: string;
        expirationTime: number | null;
        keys: { auth: string; p256dh: string };
        userId: Id<"users">;
      }>
    >;
  };
  reconciliation: {
    deleteOrphans: FunctionReference<
      "mutation",
      "internal",
      { batchSize?: number; childTable: string; parentField: string },
      { deleted: number; remaining: boolean; scanned: number }
    >;
    orphanReport: FunctionReference<
      "query",
      "internal",
      {},
      Array<{
        orphanCount: number;
        relationship: string;
        scannedCount: number;
        truncated: boolean;
      }>
    >;
  };
  shares: {
    bumpLastUsed: FunctionReference<
      "mutation",
      "internal",
      { shareId: string },
      null
    >;
    checkGuestAccess: FunctionReference<
      "query",
      "internal",
      {
        accessLevel?: "view" | "edit" | "join";
        resourceId: string;
        resourceType: "doc" | "diagram" | "spreadsheet";
        shareId: string;
      },
      boolean
    >;
    loadActiveShare: FunctionReference<
      "query",
      "internal",
      { shareId: string },
      null | {
        accessLevel: "view" | "edit" | "join";
        resourceId: string;
        resourceType: "document" | "diagram" | "spreadsheet" | "channel";
        workspaceId: Id<"workspaces">;
      }
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
      Array<{ cellRef: string }>
    >;
    getSpreadsheetInternal: FunctionReference<
      "query",
      "internal",
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
  storageGc: {
    runGarbageCollection: FunctionReference<
      "mutation",
      "internal",
      {
        cursor: string | null;
        totalDeleted?: number;
        totalScanned?: number;
        workspaceCounts?: string;
      },
      null
    >;
  };
  tasks: {
    getInternal: FunctionReference<
      "query",
      "internal",
      { taskId: Id<"tasks"> },
      {
        _creationTime: number;
        _id: Id<"tasks">;
        projectId: Id<"projects">;
        workspaceId: Id<"workspaces">;
      } | null
    >;
  };
  userDenormalizationSync: {
    syncToChannelMembers: FunctionReference<
      "mutation",
      "internal",
      { userId: Id<"users"> },
      null
    >;
  };
  workspaceMembers: {
    listUserIds: FunctionReference<
      "query",
      "internal",
      { workspaceId: Id<"workspaces"> },
      Array<Id<"users">>
    >;
  };
};

export declare const components: {
  auditLog: import("convex-audit-log/_generated/component.js").ComponentApi<"auditLog">;
  convexCascadingDelete: import("convex-cascading-delete/_generated/component.js").ComponentApi<"convexCascadingDelete">;
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  notificationPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"notificationPool">;
  documentsByWorkspace: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"documentsByWorkspace">;
  diagramsByWorkspace: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"diagramsByWorkspace">;
  spreadsheetsByWorkspace: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"spreadsheetsByWorkspace">;
  projectsByWorkspace: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"projectsByWorkspace">;
  channelsByWorkspace: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"channelsByWorkspace">;
  membersByWorkspace: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"membersByWorkspace">;
  tasksByWorkspace: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"tasksByWorkspace">;
};
