/**
 * Display naming for the issue-tracker providers Ripple integrates with.
 *
 * The stored `provider` is an open string (schema: `v.string()`) and legacy
 * `tasks.externalRefs` rows predate the field entirely, so every caller needs
 * the same two-step: map the known providers, fall back to "GitHub" for
 * anything else. That fallback used to be re-derived at seven sites across the
 * task surfaces — four copies of an identical record plus three inline
 * ternaries — which is why it lives here rather than beside any one of them.
 */
const PROVIDER_LABEL: Record<string, string> = {
  github: "GitHub",
  gitlab: "GitLab",
};

/**
 * Human-readable name for a stored provider id. Unknown and absent providers
 * both read as "GitHub" so copy stays grammatical for legacy refs; callers that
 * care about the distinction gate on the link before reaching for a label.
 */
export function providerLabel(provider: string | undefined): string {
  return (provider !== undefined && PROVIDER_LABEL[provider]) || "GitHub";
}
