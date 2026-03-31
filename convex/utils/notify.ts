import type { MutationCtx } from "../_generated/server";
import type { NotificationCategory } from "@shared/notificationCategories";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { scheduleNotification } from "../notificationPool";

// ─── Types ───────────────────────────────────────────────────────────

type BaseArgs = {
  category: NotificationCategory;
  /** Current user who triggered the event */
  userId: Id<"users">;
  userName: string;
  /** Push notification content */
  title: string;
  body: string;
  url: string;
  /** Per-resource preference filtering (projectId for tasks, channelId for chat) */
  resourceId?: Id<"projects"> | Id<"channels">;
};

type WithRecipients = BaseArgs & {
  /** Explicit list of recipient user IDs (mentions, assignee, etc.) */
  recipientIds: (string | Id<"users">)[];
};

type WithWorkspace = BaseArgs & {
  /** Broadcast to all workspace members (minus sender) */
  workspaceId: Id<"workspaces">;
};

type NotifyArgs = WithRecipients | WithWorkspace;

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Unified notification dispatcher. Call from mutations to send push
 * notifications through the workpool.
 *
 * Supports two recipient modes:
 * - `recipientIds`: explicit list (mentions, assignee). Self is NOT auto-filtered.
 * - `workspaceId`: broadcast to all workspace members, excluding `userId`.
 */
export async function notify(
  ctx: MutationCtx,
  args: NotifyArgs,
): Promise<void> {
  await scheduleNotification(ctx, internal.notifications.deliverPush, {
    senderId: args.userId,
    category: args.category,
    title: args.title,
    body: args.body,
    url: args.url,
    recipientIds: "recipientIds" in args ? args.recipientIds.map(String) : undefined,
    workspaceId: "workspaceId" in args ? args.workspaceId : undefined,
    resourceId: args.resourceId as string | undefined,
  });
}
