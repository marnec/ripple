/**
 * Description sync — provider-agnostic logic for the GitHub→Ripple
 * creation-time seed and the manual Ripple→GitHub push.
 *
 * Phase 6 of the GitHub integration. Ripple is the source of truth: GitHub
 * issue bodies are seeded into the Yjs description ONLY at task creation
 * time, and subsequent updates flow Ripple→GitHub via an explicit "Sync"
 * button. There is no reconciliation: once seeded, the Ripple description
 * is canonical and GitHub-side edits to the issue body are ignored.
 */

/**
 * The "Sync description to GitHub" button is visible whenever the task has
 * a non-empty description AND a linked GitHub issue. Without reconciliation
 * we can't tell "synced vs desynced" — clicking simply pushes the current
 * description. Redundant pushes are harmless (GitHub no-ops identical
 * bodies).
 */
export function isSyncDescriptionButtonVisible(input: {
  hasLinkedIssue: boolean;
  isDescriptionEmpty: boolean;
}): boolean {
  return input.hasLinkedIssue && !input.isDescriptionEmpty;
}
