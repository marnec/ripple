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
  /** Per-resource preference filtering (projectId for tasks, channelId for chat).
   *  Used only for the explicit-recipient path. */
  resourceId?: Id<"projects"> | Id<"channels">;
};

type WithRecipients = BaseArgs & {
  /** Explicit list of recipient user IDs (mentions, assignee, etc.) */
  recipientIds: (string | Id<"users">)[];
};

type WithScope = BaseArgs & {
  /** Broadcast scope: the ID that subscription rows are keyed on.
   *  For workspace-scoped categories this is the workspaceId.
   *  For channel-scoped categories this is the channelId. */
  scope: string;
};

type NotifyArgs = WithRecipients | WithScope;

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Unified notification dispatcher. Call from mutations to send push
 * notifications through the workpool.
 *
 * Supports two recipient modes:
 * - `recipientIds`: explicit list (mentions, assignee). Self is NOT auto-filtered.
 * - `scope`: broadcast via materialized subscriptions, excluding `userId`.
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
    scope: "scope" in args ? args.scope : undefined,
    resourceId: args.resourceId as string | undefined,
  });
}
