/**
 * Keys of the per-workspace capabilities gated by `workspaceEntitlements`
 * (`hasFeature` in `integrations/core/entitlements.ts`).
 *
 * The integration keys (`github_integration`, `gitlab_integration`) predate
 * this file and are still spelled inline where they are used; new keys go
 * here so the backend gate and the settings toggle cannot drift apart.
 */
export const FeatureKey = {
  /** The workspace assistant: the AI bot that answers when @-mentioned in chat. */
  AI_ASSISTANT: "ai_assistant",
} as const;

export type FeatureKey = (typeof FeatureKey)[keyof typeof FeatureKey];
