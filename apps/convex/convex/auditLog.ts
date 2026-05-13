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
  | "workspaceInvites"
  | "calendarEvents"
  | "shares";

export async function logActivity(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    resourceType: ResourceType;
    resourceId: string;
    action: string;
    resourceName?: string;
    oldValue?: string;
    newValue?: string;
    scope?: string;
  },
) {
  // Failure isolation: audit logging must never abort a user-facing
  // mutation. The component already defers its expensive aggregate
  // updates internally, so the only remaining failure surface is the
  // single append-only insert into `auditLogs` — which we'd rather
  // drop than have take the whole mutation down with it.
  try {
    await auditLog.log(ctx, {
      action: `${args.resourceType}.${args.action}`,
      actorId: args.userId.toString(),
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      severity: "info",
      metadata: {
        resourceName: args.resourceName,
        oldValue: args.oldValue,
        newValue: args.newValue,
      },
      scope: args.scope,
    });
  } catch (err) {
    console.error(
      `[auditLog] failed to log ${args.resourceType}.${args.action}`,
      err,
    );
  }
}

export async function logTaskActivity(
  ctx: MutationCtx,
  args: {
    taskId: Id<"tasks">;
    userId: Id<"users">;
    workspaceId: Id<"workspaces">;
    taskTitle: string;
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
    resourceName: args.taskTitle,
    oldValue: args.oldValue,
    newValue: args.newValue,
    scope: args.workspaceId,
  });
}
