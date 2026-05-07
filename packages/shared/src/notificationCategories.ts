export const TASK_NOTIFICATION_CATEGORIES = [
  "taskAssigned",
  "taskDescriptionMention",
  "taskCommentMention",
  "taskComment",
  "taskStatusChange",
] as const;

export type TaskNotificationCategory = (typeof TASK_NOTIFICATION_CATEGORIES)[number];

export function isTaskCategory(cat: NotificationCategory): cat is TaskNotificationCategory {
  return (TASK_NOTIFICATION_CATEGORIES as readonly string[]).includes(cat);
}

export const DEFAULT_PROJECT_TASK_PREFERENCES: Record<TaskNotificationCategory, boolean> = {
  taskAssigned: true,
  taskDescriptionMention: true,
  taskCommentMention: true,
  taskComment: true,
  taskStatusChange: true,
};

export const CHAT_NOTIFICATION_CATEGORIES = [
  "chatMention",
  "chatChannelMessage",
] as const;

export type ChatNotificationCategory = (typeof CHAT_NOTIFICATION_CATEGORIES)[number];

export function isChatCategory(cat: NotificationCategory): cat is ChatNotificationCategory {
  return (CHAT_NOTIFICATION_CATEGORIES as readonly string[]).includes(cat);
}

export const DEFAULT_CHANNEL_CHAT_PREFERENCES: Record<ChatNotificationCategory, boolean> = {
  chatMention: true,
  chatChannelMessage: true,
};

export const NOTIFICATION_CATEGORIES = [
  "chatMention",
  "chatChannelMessage",
  "taskAssigned",
  "taskDescriptionMention",
  "taskCommentMention",
  "taskComment",
  "taskStatusChange",
  "documentMention",
  "documentCreated",
  "documentDeleted",
  "spreadsheetCreated",
  "spreadsheetDeleted",
  "diagramCreated",
  "diagramDeleted",
  "projectCreated",
  "projectDeleted",
  "channelCreated",
  "channelDeleted",
  "channelJoinRequest",
  "channelJoinDecision",
  "eventInvited",
  "eventUpdated",
  "eventCancelled",
  "eventResponseChanged",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  chatMention: "@mentions in chat",
  chatChannelMessage: "New channel messages",
  taskAssigned: "Assigned to a task",
  taskDescriptionMention: "@mentioned in task description",
  taskCommentMention: "@mentioned in task comment",
  taskComment: "Comments on your assigned tasks",
  taskStatusChange: "Status changes on your tasks",
  documentMention: "@mentioned in a document",
  documentCreated: "Document created",
  documentDeleted: "Document deleted",
  spreadsheetCreated: "Spreadsheet created",
  spreadsheetDeleted: "Spreadsheet deleted",
  diagramCreated: "Diagram created",
  diagramDeleted: "Diagram deleted",
  projectCreated: "Project created",
  projectDeleted: "Project deleted",
  channelCreated: "Channel created",
  channelDeleted: "Channel deleted",
  channelJoinRequest: "Channel join requests",
  channelJoinDecision: "Channel join decisions",
  eventInvited: "Invited to a calendar event",
  eventUpdated: "Calendar event updated",
  eventCancelled: "Calendar event cancelled",
  eventResponseChanged: "Invitee responded to your event",
};

export type NotificationGroup = {
  label: string;
  categories: NotificationCategory[];
  perResource?: string;
};

export const NOTIFICATION_GROUPS: NotificationGroup[] = [
  {
    label: "Chat",
    perResource: "channel",
    categories: ["chatMention", "chatChannelMessage"],
  },
  {
    label: "Tasks",
    perResource: "project",
    categories: [
      "taskAssigned",
      "taskDescriptionMention",
      "taskCommentMention",
      "taskComment",
      "taskStatusChange",
    ],
  },
  {
    label: "Documents",
    categories: ["documentMention", "documentCreated", "documentDeleted"],
  },
  {
    label: "Spreadsheets",
    categories: ["spreadsheetCreated", "spreadsheetDeleted"],
  },
  {
    label: "Diagrams",
    categories: ["diagramCreated", "diagramDeleted"],
  },
  {
    label: "Projects & Channels",
    categories: [
      "projectCreated",
      "projectDeleted",
      "channelCreated",
      "channelDeleted",
      "channelJoinRequest",
      "channelJoinDecision",
    ],
  },
  {
    label: "Calendar",
    categories: [
      "eventInvited",
      "eventUpdated",
      "eventCancelled",
      "eventResponseChanged",
    ],
  },
];

// ── Broadcast scope classification ──────────────────────────────────
// Only categories that use `scope` (broadcast) delivery need materialized
// subscription rows. Categories using `recipientIds` (targeted) do NOT —
// they resolve preferences inline at delivery time for small N.

/** Workspace-scoped broadcast categories (scope = workspaceId). */
export const BROADCAST_WORKSPACE_CATEGORIES = [
  "documentCreated",
  "documentDeleted",
  "spreadsheetCreated",
  "spreadsheetDeleted",
  "diagramCreated",
  "diagramDeleted",
  "projectCreated",
  "projectDeleted",
  "channelCreated",
  "channelDeleted",
] as const;

/** Channel-scoped broadcast categories (scope = channelId). */
export const BROADCAST_CHANNEL_CATEGORIES = [
  "chatChannelMessage",
] as const;

// NOTE: No project-scoped broadcast categories exist — all task categories
// (taskAssigned, taskStatusChange, etc.) use recipientIds (targeted).

export type ScopeType = "workspace" | "channel";

export function getCategoryScope(cat: NotificationCategory): ScopeType {
  if ((BROADCAST_CHANNEL_CATEGORIES as readonly string[]).includes(cat)) return "channel";
  return "workspace";
}

/** Kept for backwards compatibility — union of all broadcast categories. */
export const WORKSPACE_SCOPED_CATEGORIES = BROADCAST_WORKSPACE_CATEGORIES;

// ── Per-channel preference axis ─────────────────────────────────────
// Categories that send email in addition to push declare it here. The
// settings UI reads this to decide whether to render an Email column,
// and the `notificationPreferences` schema stores those categories as
// `{ push, email }` objects (see prefersChannel for the read path).
//
// Adding a new email-supporting category: list it here, widen its
// schema field to `v.union(v.boolean(), v.object({ push, email }))`,
// and emit the email from the relevant mutation. Other categories
// stay flat booleans until they get email support.

export type NotificationChannel = "push" | "email";

export const CATEGORY_CHANNELS: Record<NotificationCategory, ReadonlyArray<NotificationChannel>> = {
  chatMention: ["push"],
  chatChannelMessage: ["push"],
  taskAssigned: ["push"],
  taskDescriptionMention: ["push"],
  taskCommentMention: ["push"],
  taskComment: ["push"],
  taskStatusChange: ["push"],
  documentMention: ["push"],
  documentCreated: ["push"],
  documentDeleted: ["push"],
  spreadsheetCreated: ["push"],
  spreadsheetDeleted: ["push"],
  diagramCreated: ["push"],
  diagramDeleted: ["push"],
  projectCreated: ["push"],
  projectDeleted: ["push"],
  channelCreated: ["push"],
  channelDeleted: ["push"],
  channelJoinRequest: ["push"],
  channelJoinDecision: ["push"],
  eventInvited: ["push", "email"],
  eventUpdated: ["push", "email"],
  eventCancelled: ["push", "email"],
  eventResponseChanged: ["push"],
};

/** Categories that store their preference as `{ push, email }` rather
 *  than a flat boolean. Used to constrain `filterUsersWantingEmail`
 *  and to type the settings UI matrix. */
export const EMAIL_CAPABLE_CATEGORIES = [
  "eventInvited",
  "eventUpdated",
  "eventCancelled",
] as const;

export type EmailCapableCategory = (typeof EMAIL_CAPABLE_CATEGORIES)[number];

export function isEmailCapableCategory(
  cat: NotificationCategory,
): cat is EmailCapableCategory {
  return (EMAIL_CAPABLE_CATEGORIES as readonly string[]).includes(cat);
}

export const DEFAULT_PREFERENCES: Record<NotificationCategory, boolean> = {
  chatMention: true,
  chatChannelMessage: true,
  taskAssigned: true,
  taskDescriptionMention: true,
  taskCommentMention: true,
  taskComment: true,
  taskStatusChange: true,
  documentMention: true,
  documentCreated: true,
  documentDeleted: true,
  spreadsheetCreated: true,
  spreadsheetDeleted: true,
  diagramCreated: true,
  diagramDeleted: true,
  projectCreated: true,
  projectDeleted: true,
  channelCreated: true,
  channelDeleted: true,
  channelJoinRequest: true,
  channelJoinDecision: true,
  eventInvited: true,
  eventUpdated: true,
  eventCancelled: true,
  eventResponseChanged: true,
};
