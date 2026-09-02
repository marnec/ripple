import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

/**
 * The vocabulary the console renders the audit trail with — shared by the
 * per-workspace page and the per-user section, and kept out of the component
 * file so Fast Refresh stays intact.
 */
export type ActivityEntry = FunctionReturnType<
  typeof api.admin.activity.list
>["entries"][number];

/** Sentinel for "no filter" in the Select controls — not a resource type. */
export const ALL = "all";

/** The `ResourceType` union `auditLog.ts` writes — the only scopes that exist. */
export const RESOURCE_TYPES = [
  "tasks",
  "documents",
  "diagrams",
  "spreadsheets",
  "channels",
  "projects",
  "workspaces",
  "cycles",
  "channelMembers",
  "workspaceInvites",
  "calendarEvents",
  "shares",
] as const;

export const RESOURCE_LABEL: Record<string, string> = {
  [ALL]: "All activity",
  tasks: "Tasks",
  documents: "Documents",
  diagrams: "Diagrams",
  spreadsheets: "Spreadsheets",
  channels: "Channels",
  projects: "Projects",
  workspaces: "Workspace",
  cycles: "Cycles",
  channelMembers: "Channel members",
  workspaceInvites: "Invites",
  calendarEvents: "Calendar events",
  shares: "Share links",
};

/** Singular noun for the sentence, e.g. "renamed **document** “Spec”". */
export const RESOURCE_NOUN: Record<string, string> = {
  tasks: "task",
  documents: "document",
  diagrams: "diagram",
  spreadsheets: "spreadsheet",
  channels: "channel",
  projects: "project",
  workspaces: "workspace",
  cycles: "cycle",
  channelMembers: "member",
  workspaceInvites: "invite",
  calendarEvents: "event",
  shares: "share link",
};

export const SEVERITY_CLASS: Record<string, string> = {
  warning: "text-primary",
  error: "text-destructive",
  critical: "font-semibold text-destructive",
};

export const CASCADE_TABLE_LABELS: Record<string, string> = {
  messages: "message",
  messageReactions: "reaction",
  channelMembers: "member",
  channelNotificationPreferences: "notification pref",
  callSessions: "call session",
  tasks: "task",
  taskComments: "comment",
  taskStatuses: "status",
  cycleTasks: "cycle task",
  cycles: "cycle",
  edges: "connection",
  nodes: "node",
  favorites: "favorite",
  recentActivity: "activity entry",
  documentBlockRefs: "block ref",
  spreadsheetCellRefs: "cell ref",
  projectNotificationPreferences: "notification pref",
};
