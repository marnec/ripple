/**
 * Conventional branch name for an issue: `<issueNumber>-<slug-of-title>`,
 * matching GitHub's own "create a branch for this issue" format and reused
 * verbatim for GitLab (where `issueNumber` is the issue iid). The leading
 * issue number is what lets a PR/MR opened from this branch auto-link to the
 * task (see `parseBranchIssueNumber`) without a `Closes #N` keyword.
 *
 * Provider-agnostic and pure — lives in `core/` so both the GitHub and GitLab
 * branch actions name branches identically (a divergence here would silently
 * break cross-provider auto-linking parity).
 */
export function branchNameForIssue(issueNumber: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return slug ? `${issueNumber}-${slug}` : `${issueNumber}`;
}
