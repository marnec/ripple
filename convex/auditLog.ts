import { AuditLog } from "convex-audit-log";
import { components } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const auditLog = new AuditLog(components.auditLog);

type ResourceType =
  | "tasks"
  | "documents"
  | "diagrams"
  | "spreadsheets"
  | "channels"
  | "projects"
  | "workspaces"
  | "cycles"
  | "channelMembers"
  | "workspaceInvites";

export async function logActivity(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    resourceType: ResourceType;
    resourceId: string;
    action: string;
    oldValue?: string;
    newValue?: string;
  },
) {
  await auditLog.log(ctx, {
    action: `${args.resourceType}.${args.action}`,
    actorId: args.userId.toString(),
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    severity: "info",
    metadata: { oldValue: args.oldValue, newValue: args.newValue },
  });
}

export async function logTaskActivity(
  ctx: MutationCtx,
  args: {
    taskId: Id<"tasks">;
    userId: Id<"users">;
    type: string;
    oldValue?: string;
    newValue?: string;
  },
) {
  await logActivity(ctx, {
    userId: args.userId,
    resourceType: "tasks",
    resourceId: args.taskId.toString(),
    action: args.type,
    oldValue: args.oldValue,
    newValue: args.newValue,
  });
}
