import { v } from "convex/values";
import { internalMutation } from "../../functions";
import type { Id } from "../../_generated/dataModel";
import { applyNormalizedEvent } from "./syncIn";
import type { NormalizedIssueEvent } from "./types";

interface ExternalAuthor {
  login: string;
  avatarUrl: string;
  url: string;
}

/**
 * An assignee as the provider reports it. `id` is the provider-side numeric
 * user id, present only for providers that address members by id (GitLab); the
 * reconciler picks the match key per provider.
 */
interface ExternalAssignee extends ExternalAuthor {
  id?: string;
}

export interface GithubIssueSnapshot {
  externalIssueId: string;
  issueNumber: number;
  state: "open" | "closed";
  stateReason?: "completed" | "not_planned" | null;
  title: string;
  body: string;
  url: string;
  externalAuthor: ExternalAuthor;
  labels: string[];
  assignees: ExternalAssignee[];
}

export interface RippleTaskSnapshot {
  completed: boolean;
}

/**
 * Pure synthesis: given the current GitHub truth for an issue and the
 * current Ripple task state, return the normalized events that, when fed
 * through `applyNormalizedEvent`, drive Ripple back into agreement.
 *
 * Force resync uses synthesized events instead of bespoke patch code so the
 * existing inbound code path owns every "how do we reconcile X" rule (e.g.,
 * reopen → triage, labels are name-based, etc.). The cost is a few extra
 * `applyNormalizedEvent` invocations per drifted issue — cheap relative to
 * the GitHub fetch this gets paired with.
 *
 * `now` is the first synthesized event's `externalUpdatedAt` — it must be newer
 * than any stored value or the inbound ordering guard will drop the event. The
 * action body passes `Date.now()`.
 *
 * Each subsequent event is stamped one ms later. This is not cosmetic: applying
 * an event advances the link mirror's `externalUpdatedAt` to that stamp, and the
 * guard drops anything not *strictly* newer — so one shared `now` across the
 * batch would converge the first facet and silently abandon the rest (a reopen
 * would land and the assignee behind it never would).
 */
export function synthesizeReconciliationEvents(input: {
  now: number;
  ripple: RippleTaskSnapshot;
  github: GithubIssueSnapshot;
}): NormalizedIssueEvent[] {
  const { now, ripple, github } = input;
  const events: NormalizedIssueEvent[] = [];
  // Monotonic stamp per emitted event, in emission order.
  let stamp = now;
  const nextStamp = () => stamp++;
  if (github.state === "open" && ripple.completed) {
    events.push({
      kind: "issue.reopened",
      externalIssueId: github.externalIssueId,
      issueNumber: github.issueNumber,
      externalUpdatedAt: nextStamp(),
      title: github.title,
      body: github.body,
      url: github.url,
      externalAuthor: github.externalAuthor,
    });
  }
  if (github.state === "closed" && !ripple.completed) {
    events.push({
      kind: "issue.closed",
      externalIssueId: github.externalIssueId,
      issueNumber: github.issueNumber,
      externalUpdatedAt: nextStamp(),
      title: github.title,
      body: github.body,
      url: github.url,
      externalAuthor: github.externalAuthor,
      stateReason: github.stateReason === "not_planned" ? "not_planned" : "completed",
    });
  }
  // Labels + assignees are always emitted. The inbound apply functions
  // diff against the link mirror and no-op when there's no drift, so the
  // cost of an emit-and-let-it-no-op is one extra DB read per resync.
  events.push({
    kind: "issue.labels_changed",
    externalIssueId: github.externalIssueId,
    issueNumber: github.issueNumber,
    externalUpdatedAt: nextStamp(),
    labels: github.labels,
  });
  events.push({
    kind: "issue.assignees_changed",
    externalIssueId: github.externalIssueId,
    issueNumber: github.issueNumber,
    externalUpdatedAt: nextStamp(),
    assignees: github.assignees,
  });
  return events;
}

/**
 * Per-issue apply step. Called by the force-resync action once per
 * `taskIntegrationLinks` row, with the snapshot it just fetched from
 * GitHub. Synthesizes the normalized events and pumps each through
 * `applyNormalizedEvent` — the same code path live webhooks use, so the
 * reconciliation rules stay in one place.
 *
 * Re-checks the link's resync eligibility — the link may have become
 * disconnected or entitlement-frozen between the mutation that scheduled
 * the action and this per-issue apply.
 */
export const applyOneIssueReconciliation = internalMutation({
  args: {
    projectIntegrationLinkId: v.id("projectIntegrationLinks"),
    rippleCompleted: v.boolean(),
    issue: v.object({
      externalIssueId: v.string(),
      issueNumber: v.number(),
      state: v.union(v.literal("open"), v.literal("closed")),
      stateReason: v.optional(
        v.union(v.literal("completed"), v.literal("not_planned"), v.null()),
      ),
      title: v.string(),
      body: v.string(),
      url: v.string(),
      externalAuthor: v.object({
        login: v.string(),
        avatarUrl: v.string(),
        url: v.string(),
      }),
      labels: v.array(v.string()),
      assignees: v.array(
        v.object({
          login: v.string(),
          avatarUrl: v.string(),
          url: v.string(),
          // Provider-side numeric user id, for providers that address members
          // by id rather than login (GitLab). Absent for GitHub. Without it a
          // GitLab resync's synthesized `issue.assignees_changed` can't match
          // any member — see `syncIn.applyAssigneesChanged`.
          id: v.optional(v.string()),
        }),
      ),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.projectIntegrationLinkId);
    if (!link) return null;
    if (link.status === "disconnected" || link.pausedByBilling) return null;

    const events = synthesizeReconciliationEvents({
      now: Date.now(),
      ripple: { completed: args.rippleCompleted },
      github: args.issue,
    });

    for (const event of events) {
      await applyNormalizedEvent(ctx, { event, link });
    }
    return null;
  },
});

void (null as unknown as Id<"projectIntegrationLinks">);
