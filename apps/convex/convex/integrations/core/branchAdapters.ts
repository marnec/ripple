import { api } from "../../_generated/api";
import type { FunctionReference } from "convex/server";
import type { Id } from "../../_generated/dataModel";

/**
 * Branch-action dispatch registry — the branch-path twin of
 * `core/outboundAdapters`.
 *
 * The three provider-agnostic branch entry points in `core/branchesAction` used
 * to hand-roll `if (provider === "github") … else if (provider === "gitlab") …`
 * in each of three handlers, so adding a provider meant editing all three. This
 * maps a provider to its per-provider branch action references; the dispatchers
 * resolve the adapter once and route through it, and a new provider becomes a
 * data change here alone.
 *
 * An unregistered (or null) provider resolves to `null`; the dispatcher then
 * returns its empty/degraded contract (`[]`, `{branches:[],defaultBranch:null}`,
 * or a "not linked" error) rather than guessing a provider.
 */

type ListRepoBranchesRef = FunctionReference<
  "action",
  "public",
  { linkId: Id<"projectIntegrationLinks"> },
  string[]
>;

type ListTaskRepoBranchesRef = FunctionReference<
  "action",
  "public",
  { taskId: Id<"tasks"> },
  { branches: string[]; defaultBranch: string | null }
>;

type CreateBranchForTaskRef = FunctionReference<
  "action",
  "public",
  { taskId: Id<"tasks">; baseBranch?: string },
  { branchName: string; baseBranch: string; alreadyExisted: boolean }
>;

export interface BranchAdapter {
  listRepoBranches: ListRepoBranchesRef;
  listTaskRepoBranches: ListTaskRepoBranchesRef;
  createBranchForTask: CreateBranchForTaskRef;
}

const GITHUB_BRANCH_ADAPTER: BranchAdapter = {
  listRepoBranches: api.integrations.github.branchesAction
    .listRepoBranches as unknown as ListRepoBranchesRef,
  listTaskRepoBranches: api.integrations.github.branchesAction
    .listTaskRepoBranches as unknown as ListTaskRepoBranchesRef,
  createBranchForTask: api.integrations.github.branchesAction
    .createBranchForTask as unknown as CreateBranchForTaskRef,
};

const GITLAB_BRANCH_ADAPTER: BranchAdapter = {
  listRepoBranches: api.integrations.gitlab.branchesAction
    .listRepoBranches as unknown as ListRepoBranchesRef,
  listTaskRepoBranches: api.integrations.gitlab.branchesAction
    .listTaskRepoBranches as unknown as ListTaskRepoBranchesRef,
  createBranchForTask: api.integrations.gitlab.branchesAction
    .createBranchForTask as unknown as CreateBranchForTaskRef,
};

const ADAPTERS: Record<string, BranchAdapter> = {
  github: GITHUB_BRANCH_ADAPTER,
  gitlab: GITLAB_BRANCH_ADAPTER,
};

/**
 * Resolve the branch adapter for a provider, or `null` when the provider is
 * unknown/absent (the caller returns its degraded contract — never falls back
 * to another provider).
 */
export function resolveBranchAdapter(
  provider: string | null,
): BranchAdapter | null {
  return provider ? ADAPTERS[provider] ?? null : null;
}
