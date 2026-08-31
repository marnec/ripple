import { getUserDisplayName } from "@ripple/shared/displayName";
import { useWorkspaceMembers } from "@/contexts/WorkspaceMembersContext";

type NamedUser =
  | { name?: string | null; email?: string | null }
  | null
  | undefined;

/**
 * Display name for a user reached by id — the fallback chain behind every
 * embedded @-mention.
 *
 * `api.users.get` and the message `mentionedUsers` batch deliberately withhold
 * `email`: both are id-addressable with no workspace scoping, so returning it
 * would publish a userId→address oracle (see `publicUserValidator`). The cost
 * was that an account with no `name` rendered as "Unknown" inside a chip the
 * composer's picker had just labelled with that person's address — the picker
 * reads `membersByWorkspace`, which is workspace-scoped and does carry it.
 *
 * So the address comes from the member list the app already has loaded rather
 * than from a widened public projection. Outside a workspace (a guest on a
 * shared document) there is no member list and the chip still says "Unknown",
 * which is exactly the exposure that projection is defending.
 */
export function useUserDisplayName(
  userId: string | null | undefined,
  user: NamedUser,
): string {
  const members = useWorkspaceMembers();

  if (user?.name) return user.name;

  const member = userId ? members?.find((m) => m._id === userId) : undefined;
  return getUserDisplayName(member ?? user);
}
