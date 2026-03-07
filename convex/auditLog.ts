import { AuditLog } from "convex-audit-log";
import { components } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const auditLog = new AuditLog(components.auditLog);

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
  await auditLog.log(ctx, {
    action: `task.${args.type}`,
    actorId: args.userId.toString(),
    resourceType: "tasks",
    resourceId: args.taskId.toString(),
    severity: "info",
    metadata: { oldValue: args.oldValue, newValue: args.newValue },
  });
}
