/**
 * Canonical user display name derivation.
 * Use this everywhere a user name is shown — messages, mentions, reactions, etc.
 */
export function getUserDisplayName(
  user: { name?: string | null; email?: string | null } | null | undefined,
): string {
  return user?.name || user?.email || "Unknown";
}
