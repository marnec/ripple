import { describe, expect, it } from "vitest";
import { WorkspaceRole, ChannelVisibility } from "@ripple/shared/enums/roles";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { withTriggers } from "../convex/dbTriggers";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";

/**
 * The **local graph** (CONTEXT.md): one resource and its direct neighbours.
 * Depth 1 only, and channel neighbours follow the channel rule — the same
 * rule `getBacklinks` applies to the same edges.
 */

function taskMentionBody(taskId: string) {
  return JSON.stringify([
    { type: "paragraph", content: [{ type: "taskMention", props: { taskId, taskTitle: "A task" } }] },
  ]);
}

async function setup() {
  const t = createTestContext();
  const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
  const projectId = await asUser.mutation(api.projects.create, {
    workspaceId,
    name: "Proj",
    color: "bg-blue-500",
  });
  const taskId = await asUser.mutation(api.tasks.create, {
    workspaceId,
    projectId,
    title: "A task",
  });
  return { t, workspaceId, asUser, projectId, taskId };
}

async function mentionInChannel(
  setupResult: Awaited<ReturnType<typeof setup>>,
  visibility: "public" | "private",
  name: string,
) {
  const { workspaceId, asUser, taskId } = setupResult;
  const channelId = await asUser.mutation(api.channels.create, {
    workspaceId,
    name,
    visibility: visibility === "public" ? ChannelVisibility.PUBLIC : ChannelVisibility.PRIVATE,
  });
  await asUser.mutation(api.messages.send, {
    isomorphicId: `m-${name}`,
    body: taskMentionBody(taskId),
    plainText: "#A task",
    channelId,
  });
  return channelId;
}

async function addMember(t: ReturnType<typeof createTestContext>, workspaceId: Id<"workspaces">) {
  const { userId, asUser } = await setupAuthenticatedUser(t, {
    name: "Colleague",
    email: "colleague@example.com",
  });
  await t.run(async (ctx) =>
    withTriggers(ctx).db.insert("workspaceMembers", {
      workspaceId,
      userId,
      role: WorkspaceRole.MEMBER,
    }),
  );
  return asUser;
}

describe("graph.getLocalGraph", () => {
  it("returns the resource, its project and the channels mentioning it", async () => {
    const s = await setup();
    const channelId = await mentionInChannel(s, "public", "general");

    const graph = await s.asUser.query(api.graph.getLocalGraph, {
      resourceId: s.taskId,
      workspaceId: s.workspaceId,
    });

    expect(graph.nodes.map((n) => n.id).sort()).toEqual(
      [s.taskId, s.projectId, channelId].sort(),
    );
    expect(graph.nodes.find((n) => n.id === channelId)?.name).toBe("#general");
    expect(graph.links).toContainEqual({ source: channelId, target: s.taskId, edgeType: "mentions" });
    expect(graph.links).toContainEqual({ source: s.taskId, target: s.projectId, edgeType: "belongs_to" });
  });

  it("does not reach past direct neighbours", async () => {
    const s = await setup();
    const otherTask = await s.asUser.mutation(api.tasks.create, {
      workspaceId: s.workspaceId,
      projectId: s.projectId,
      title: "Sibling",
    });

    const graph = await s.asUser.query(api.graph.getLocalGraph, {
      resourceId: s.taskId,
      workspaceId: s.workspaceId,
    });

    // The sibling shares the project, but that is two hops away.
    expect(graph.nodes.some((n) => n.id === otherTask)).toBe(false);
  });

  it("drops a private channel the caller is not in, and its link", async () => {
    const s = await setup();
    const privateId = await mentionInChannel(s, "private", "leadership");
    const colleague = await addMember(s.t, s.workspaceId);

    const asMember = await s.asUser.query(api.graph.getLocalGraph, {
      resourceId: s.taskId,
      workspaceId: s.workspaceId,
    });
    expect(asMember.nodes.some((n) => n.id === privateId)).toBe(true);

    const asColleague = await colleague.query(api.graph.getLocalGraph, {
      resourceId: s.taskId,
      workspaceId: s.workspaceId,
    });
    expect(JSON.stringify(asColleague)).not.toContain(privateId);
    expect(JSON.stringify(asColleague)).not.toContain("leadership");
  });

  it("returns an empty graph to a non-member", async () => {
    const s = await setup();
    const { asUser: outsider } = await setupAuthenticatedUser(s.t, {
      email: "outsider@example.com",
    });

    const graph = await outsider.query(api.graph.getLocalGraph, {
      resourceId: s.taskId,
      workspaceId: s.workspaceId,
    });
    expect(graph).toEqual({ nodes: [], links: [] });
  });
});
