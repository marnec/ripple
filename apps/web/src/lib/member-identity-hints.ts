/**
 * The "Not connected to <provider>" nudge beside a member in the workspace
 * members list. It answers one question an admin otherwise has to debug:
 * why assignee sync is not reaching someone. A member with no account-level
 * identity for a provider (see `users.githubLogin` / `users.gitlabUserId`)
 * is silently skipped by every assignee push, and only they can fix it, from
 * their own user settings — so this is a hint, not a control.
 *
 * Pure so the rule is testable without a router: the section supplies the
 * member's flags (from `workspaceMembers.membersWithRoles`) and the providers
 * the workspace has an installation for (from `install.listInstallations`).
 */

export interface MemberIdentityFlags {
  githubConnected: boolean;
  gitlabConnected: boolean;
}

/** Providers the hint has copy for, in display order. */
const PROVIDERS: ReadonlyArray<{
  provider: string;
  title: string;
  connected: (m: MemberIdentityFlags) => boolean;
}> = [
  { provider: "github", title: "GitHub", connected: (m) => m.githubConnected },
  { provider: "gitlab", title: "GitLab", connected: (m) => m.gitlabConnected },
];

/**
 * One line per provider the workspace uses that `member` has not connected.
 * Empty when there is nothing to nudge about — no active integration for a
 * provider means no hint for it, for anyone.
 */
export function missingIdentityHints(
  member: MemberIdentityFlags,
  activeProviders: ReadonlyArray<string>,
): string[] {
  const active = new Set(activeProviders);
  return PROVIDERS.filter(
    (p) => active.has(p.provider) && !p.connected(member),
  ).map((p) => `Not connected to ${p.title}`);
}
