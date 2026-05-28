import { internal } from "../../_generated/api";
import type { FunctionReference } from "convex/server";
import type { RunId } from "@convex-dev/action-retrier";

/**
 * Outbound dispatch registry (issue #44, seam 1).
 *
 * `core/outboundDispatch` is provider-agnostic, but it used to hardcode
 * `internal.integrations.github.syncOutAction.*` at every `retrier.run` call —
 * so a GitLab-linked task would have pushed to GitHub. This registry maps a
 * link's provider to its action FunctionReferences (one per outbound op) plus
 * its retry-exhaustion `onComplete` callback. Dispatch resolves the adapter
 * from `integration.provider` and routes through it.
 *
 * Adding a provider is a data change here (register its `<provider>/syncOutAction`
 * suite) — `runOutboundOp`, the sinks, and the dispatch gates stay untouched.
 * An unregistered provider resolves to `null`; dispatch then refuses to push
 * rather than silently falling back to GitHub.
 */

/** The outbound operations every provider adapter must supply an action for. */
export const OUTBOUND_OPS = [
  "createIssue",
  "issueState",
  "description",
  "labels",
  "assignees",
  "commentCreate",
  "commentEdit",
  "commentDelete",
  "issueClose",
] as const;

export type OutboundOp = (typeof OUTBOUND_OPS)[number];

/**
 * The dispatch contract an op action conforms to: a neutral arg bag. Typed
 * loosely (the per-op shapes are heterogeneous and validated at runtime by each
 * action's Convex validators); the registry's job is routing, not arg typing.
 */
type OutboundActionRef = FunctionReference<
  "action",
  "internal",
  Record<string, unknown>,
  null
>;

/**
 * Retry-exhaustion callback shape. Matches `@convex-dev/action-retrier`'s
 * `onComplete` payload; the `RunId` brand is stripped by static codegen on the
 * generated reference, so callers cast through `unknown` (the validator handles
 * it at runtime).
 */
export type OnCompleteRef = FunctionReference<
  "mutation",
  "internal",
  {
    runId: RunId;
    result:
      | { type: "success"; returnValue: unknown }
      | { type: "failed"; error: string }
      | { type: "canceled" };
  }
>;

export interface OutboundAdapter {
  ops: Record<OutboundOp, OutboundActionRef>;
  onComplete: OnCompleteRef;
}

const gh = internal.integrations.github.syncOutAction;

const GITHUB_ADAPTER: OutboundAdapter = {
  ops: {
    createIssue: gh.pushCreateIssue as unknown as OutboundActionRef,
    issueState: gh.pushIssueState as unknown as OutboundActionRef,
    description: gh.pushDescription as unknown as OutboundActionRef,
    labels: gh.pushLabelChanges as unknown as OutboundActionRef,
    assignees: gh.pushAssigneeChanges as unknown as OutboundActionRef,
    commentCreate: gh.pushCommentCreate as unknown as OutboundActionRef,
    commentEdit: gh.pushCommentEdit as unknown as OutboundActionRef,
    commentDelete: gh.pushCommentDelete as unknown as OutboundActionRef,
    issueClose: gh.pushIssueClose as unknown as OutboundActionRef,
  },
  onComplete: internal.integrations.github.syncOutMutations
    .onOutboundComplete as unknown as OnCompleteRef,
};

const gl = internal.integrations.gitlab.syncOutAction;

const GITLAB_ADAPTER: OutboundAdapter = {
  ops: {
    createIssue: gl.pushCreateIssue as unknown as OutboundActionRef,
    issueState: gl.pushIssueState as unknown as OutboundActionRef,
    description: gl.pushDescription as unknown as OutboundActionRef,
    labels: gl.pushLabelChanges as unknown as OutboundActionRef,
    assignees: gl.pushAssigneeChanges as unknown as OutboundActionRef,
    commentCreate: gl.pushCommentCreate as unknown as OutboundActionRef,
    commentEdit: gl.pushCommentEdit as unknown as OutboundActionRef,
    commentDelete: gl.pushCommentDelete as unknown as OutboundActionRef,
    issueClose: gl.pushIssueClose as unknown as OutboundActionRef,
  },
  // GitLab reuses the provider-neutral recorder/onComplete (it writes to
  // taskIntegrationLinks, not anything GitHub-specific).
  onComplete: internal.integrations.github.syncOutMutations
    .onOutboundComplete as unknown as OnCompleteRef,
};

const ADAPTERS: Record<string, OutboundAdapter> = {
  github: GITHUB_ADAPTER,
  gitlab: GITLAB_ADAPTER,
};

/**
 * Resolve the outbound adapter for a link's provider, or `null` when no adapter
 * is registered (the caller must then skip — never fall back to another
 * provider).
 */
export function resolveOutboundAdapter(provider: string): OutboundAdapter | null {
  return ADAPTERS[provider] ?? null;
}
