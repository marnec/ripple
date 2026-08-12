import { describe, expect, it } from "vitest";
import { getFunctionName } from "convex/server";
import { internal } from "../convex/_generated/api";
import type { FunctionReference } from "convex/server";
import type { ActionCtx } from "../convex/_generated/server";
import type { Id } from "../convex/_generated/dataModel";
import {
  commentCreateSink,
  commentDeleteSink,
  commentEditSink,
  issueCreateSink,
  taskStateSink,
} from "../convex/integrations/core/outboundSinks";
import { createTestContext } from "./helpers";

/**
 * The abandon leg of each concrete sink.
 *
 * `runProviderOutbound` decides *when* a mirror is abandoned (pinned in
 * `integrations.runOutboundAction.test.ts`); these pin *what it says* — the
 * `kind`/`key` pair that turns a `backgroundJobFailures` row into something
 * actionable. It is the copy-pasted half of eight near-identical builders, so
 * a wrong key is exactly the mistake that survives review.
 *
 * The seam is the sink's own dependency: an `ActionCtx` whose `runMutation` is
 * captured rather than run. No convex-test, matching the rest of this layer.
 */
function capturingCtx() {
  const calls: { ref: unknown; args: unknown }[] = [];
  const ctx = {
    runMutation: async (ref: unknown, args: unknown) => {
      calls.push({ ref, args });
      return null;
    },
  } as unknown as ActionCtx;
  return { ctx, calls };
}

const TASK_ID = "task123" as Id<"tasks">;
const COMMENT_ID = "comment123" as Id<"taskComments">;
const COMMENT_LINK_ID = "clink123" as Id<"taskCommentIntegrationLinks">;
const PROJECT_LINK_ID = "plink123" as Id<"projectIntegrationLinks">;
const TASK_LINK_ID = "tlink123" as Id<"taskIntegrationLinks">;

const ABANDONED = "Error: recorder unreachable";

describe("outbound sink abandon reporting", () => {
  it("a task-keyed sink names its op and the task it failed to mirror", async () => {
    const { ctx, calls } = capturingCtx();

    await taskStateSink(ctx, { taskId: TASK_ID, state: "closed" })
      .recordAbandoned?.(ABANDONED);

    expect(calls).toHaveLength(1);
    expect(getFunctionName(calls[0].ref as FunctionReference<"mutation">)).toBe(
      getFunctionName(internal.backgroundJobFailures.recordOutboundAbandoned),
    );
    expect(calls[0].args).toEqual({
      kind: "integrations.outbound:state",
      key: TASK_ID,
      error: ABANDONED,
    });
  });

  it("issue-create keys on the task — the link row it would have written does not exist yet", async () => {
    const { ctx, calls } = capturingCtx();

    await issueCreateSink(ctx, {
      taskId: TASK_ID,
      projectIntegrationLinkId: PROJECT_LINK_ID,
    }).recordAbandoned?.(ABANDONED);

    expect(calls[0].args).toEqual({
      kind: "integrations.outbound:createIssue",
      key: TASK_ID,
      error: ABANDONED,
    });
  });

  it("comment-create keys on the comment", async () => {
    const { ctx, calls } = capturingCtx();

    await commentCreateSink(ctx, {
      commentId: COMMENT_ID,
      taskIntegrationLinkId: TASK_LINK_ID,
    }).recordAbandoned?.(ABANDONED);

    expect(calls[0].args).toEqual({
      kind: "integrations.outbound:commentCreate",
      key: COMMENT_ID,
      error: ABANDONED,
    });
  });

  it("comment edit and delete key on the comment link, and say which op", async () => {
    const edit = capturingCtx();
    const del = capturingCtx();

    await commentEditSink(edit.ctx, COMMENT_LINK_ID).recordAbandoned?.(ABANDONED);
    await commentDeleteSink(del.ctx, COMMENT_LINK_ID).recordAbandoned?.(ABANDONED);

    expect(edit.calls[0].args).toMatchObject({
      kind: "integrations.outbound:commentEdit",
      key: COMMENT_LINK_ID,
    });
    expect(del.calls[0].args).toMatchObject({
      kind: "integrations.outbound:commentDelete",
      key: COMMENT_LINK_ID,
    });
  });

  it("the reported job reaches the same table every retried pool reports to", async () => {
    const t = createTestContext();

    await t.mutation(internal.backgroundJobFailures.recordOutboundAbandoned, {
      kind: "integrations.outbound:createIssue",
      key: TASK_ID,
      error: ABANDONED,
    });

    const failures = await t.run(async (ctx) =>
      ctx.db.query("backgroundJobFailures").collect(),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      kind: "integrations.outbound:createIssue",
      key: TASK_ID,
      error: ABANDONED,
    });
    expect(failures[0].failedAt).toEqual(expect.any(Number));
  });
});
