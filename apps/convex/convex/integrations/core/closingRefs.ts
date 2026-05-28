/**
 * Provider-neutral parsing of the issue references a PR/MR carries — closing
 * keywords in its title/body plus the leading number of a conventional source
 * branch. Hoisted out of the GitHub adapter because GitLab needs the exact same
 * number-path: auto-close is default-branch-only on both providers, so Ripple's
 * self-parsed `Closes #N` fallback is the right fix for either. The
 * GitHub-specific GraphQL node-id enrichment (`closingIssuesReferences`) stays
 * in the GitHub adapter and layers on top of this shared number path.
 */

/**
 * The issue-closing keywords. Matched against PR/MR title + body so we link to
 * a task regardless of base branch — both GitHub's closing graph and GitLab's
 * auto-close only resolve when the PR/MR targets the repo's default branch,
 * which would silently break branch→status automation for non-default targets.
 */
const CLOSING_KEYWORD_RE =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?\s+#(\d+)/gi;

/**
 * Parse same-repo closing references (`closes #27`, `fixes: #4`, …) out of PR
 * text into issue numbers. Deduped; cross-repo (`owner/repo#N`) and URL forms
 * are intentionally out of scope (the common case is same-repo `#N`).
 */
export function parseClosingIssueNumbers(
  text: string | null | undefined,
): number[] {
  if (!text) return [];
  const found = new Set<number>();
  for (const m of text.matchAll(CLOSING_KEYWORD_RE)) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n > 0) found.add(n);
  }
  return [...found];
}

/**
 * Extract the leading issue number from a branch following the
 * `<issueNumber>-<slug>` convention (what Ripple's "Create branch" and
 * GitHub's native "create branch for issue" produce). Lets a PR auto-link to
 * its task by source branch, with no `Closes #N` keyword. Returns null for
 * branches that don't start with `<digits>-` (or bare `<digits>`).
 */
export function parseBranchIssueNumber(
  headRef: string | null | undefined,
): number | null {
  if (!headRef) return null;
  const m = /^(\d+)(?:-|$)/.exec(headRef);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Issue numbers a PR/MR references for linking: closing keywords in its
 * title/body PLUS the leading number of a conventional source branch
 * (`<issueNumber>-…`). Both are branch-independent, so a PR linked either way
 * drives branch→status automation even when it targets a non-default branch.
 */
export function collectReferencedIssueNumbers(
  text: string | null | undefined,
  branchRef: string | null | undefined,
): number[] {
  const numbers = new Set(parseClosingIssueNumbers(text));
  const fromBranch = parseBranchIssueNumber(branchRef);
  if (fromBranch !== null) numbers.add(fromBranch);
  return [...numbers];
}
