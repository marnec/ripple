/**
 * Per-channel preference reader. Pure function — kept in a standalone
 * file so unit tests can import it without spinning up the Convex test
 * harness.
 *
 * The `notificationPreferences` table stores three event categories
 * (eventInvited, eventUpdated, eventCancelled) as either a legacy
 * boolean (push-only meaning) or the new `{ push, email }` object.
 * `prefersChannel` resolves either shape against a per-channel default.
 */

import {
  DEFAULT_PREFERENCES,
  type NotificationCategory,
  type NotificationChannel,
} from "@ripple/shared/notificationCategories";

/** Minimal shape needed for the read — accepts the full Doc or null. */
type PrefsRow = Record<string, unknown> | null | undefined;

export function prefersChannel(
  prefs: PrefsRow,
  category: NotificationCategory,
  channel: NotificationChannel,
): boolean {
  const fallback = DEFAULT_PREFERENCES[category] ?? true;
  if (!prefs) return fallback;
  const value = prefs[category];
  if (value === undefined) return fallback;
  if (typeof value === "boolean") {
    // Legacy bool: gates push only. The user could not have meaningfully
    // said "no" to email when no email path existed, so we default the
    // email channel to true and require an explicit object write to opt
    // out.
    return channel === "push" ? value : true;
  }
  const obj = value as { push?: boolean; email?: boolean };
  return obj[channel] ?? fallback;
}
