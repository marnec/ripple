/**
 * What actually reached push delivery.
 *
 * Push notifications used to be observable as `_scheduled_functions` rows named
 * `notifications:deliverPush`, because `scheduleNotification` fell back to the
 * scheduler under `VITEST`. That shim is gone (it made the pool — and every
 * retry setting on it — untestable), so the observable moved one step
 * downstream: drain the pool and record what `deliverPush` handed to the web
 * push helpers. The recorded list is the same list the old helper read out of
 * the scheduled row's args, so assertions carry over unchanged in meaning.
 *
 * Recipients are recorded *before* per-user preference filtering, exactly as
 * the scheduled-args view was: these suites assert on who a mutation decided to
 * notify, not on who has notifications switched on.
 *
 * Usage — in a test file, alongside `vi.useFakeTimers()`:
 *
 * ```ts
 * vi.mock("../convex/utils/sendPushToUsers", async () => {
 *   const probe = await import("./pushProbe");
 *   return probe.pushDeliveryMock();
 * });
 * ```
 */

export type DeliveredPush = {
  /** Who the sender aimed at, before preference filtering. */
  recipientIds: string[];
  /** Only the targeted path (mentions, assignee) carries one. */
  category?: string;
  title: string;
  body: string;
  url: string;
};

export const deliveredPushes: DeliveredPush[] = [];

export function resetDeliveredPushes(): void {
  deliveredPushes.length = 0;
}

function record(
  userIds: readonly (string | { toString(): string })[],
  notification: string,
  category?: string,
): void {
  const parsed = JSON.parse(notification) as {
    title: string;
    body: string;
    data?: { url?: string };
  };
  deliveredPushes.push({
    recipientIds: userIds.map(String),
    category,
    title: parsed.title,
    body: parsed.body,
    url: parsed.data?.url ?? "",
  });
}

/** The module replacement to return from `vi.mock`. */
export function pushDeliveryMock() {
  return {
    sendPushToUsers: async (
      _ctx: unknown,
      userIds: readonly string[],
      notification: string,
    ) => {
      record(userIds, notification);
    },
    sendPushToFilteredUsers: async (
      _ctx: unknown,
      userIds: readonly string[],
      category: string,
      notification: string,
    ) => {
      record(userIds, notification, category);
    },
  };
}
