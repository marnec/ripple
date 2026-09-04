/**
 * Ordering and filtering for the members lists (workspace settings and channel
 * settings both render `@/components/MemberList` over these). Pure, and kept
 * out of the component file so both lists provably agree on "who comes first"
 * and "does this row match what I typed" rather than each re-deriving it.
 *
 * `WorkspaceRole` and `ChannelRole` are the same two literals, which is what
 * lets one comparator serve both rosters.
 */
export type MemberRole = "admin" | "member";

/**
 * Admins first (they are who you opened the panel to change), then by name.
 * Insertion order — what both lists used to show — put whoever joined first on
 * top, which is meaningless to the person scanning for someone.
 */
export function byRoleThenName<T extends { role: MemberRole; name: string }>(
  a: T,
  b: T,
): number {
  if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/**
 * Case-insensitive match over the two fields a row actually shows. An empty or
 * whitespace-only query matches everything, so the filter can be applied
 * unconditionally.
 */
export function matchesMemberQuery(
  member: { name: string; email?: string },
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    member.name.toLowerCase().includes(needle) ||
    (member.email?.toLowerCase().includes(needle) ?? false)
  );
}
