/**
 * Pure helpers for the activation wizard's GitHub-facing actions. Kept in a
 * non-"use node" module so unit tests can exercise the shaping/query logic
 * without spinning up an action runtime.
 */

interface RawGithubRepo {
  node_id: string;
  full_name: string;
  private: boolean;
}

export interface WizardRepo {
  externalRepoId: string;
  fullName: string;
  private: boolean;
}

/** Map GitHub's `/installation/repositories` rows to the wizard repo shape. */
export function shapeRepos(raw: readonly RawGithubRepo[]): WizardRepo[] {
  return raw.map((r) => ({
    externalRepoId: r.node_id,
    fullName: r.full_name,
    private: r.private,
  }));
}

/**
 * Build the GitHub Search-API `q` for the import preview count. Scopes to the
 * repo and `type:issue` (the search API conflates issues + PRs otherwise),
 * applies the open-only default, and appends one `label:` qualifier per
 * filter label (quoting any label containing whitespace).
 */
export function buildIssueSearchQuery(opts: {
  repoFullName: string;
  includeClosed: boolean;
  labels: string[];
}): string {
  const parts = [`repo:${opts.repoFullName}`, "type:issue"];
  if (!opts.includeClosed) parts.push("state:open");
  for (const label of opts.labels) {
    parts.push(/\s/.test(label) ? `label:"${label}"` : `label:${label}`);
  }
  return parts.join(" ");
}
