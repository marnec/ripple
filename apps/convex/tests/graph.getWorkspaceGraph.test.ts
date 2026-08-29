import { describe, expect, it } from "vitest";
import { ChannelType, WorkspaceRole, ChannelVisibility } from "@ripple/shared/enums/roles";
import { api } from "../convex/_generated/api";
import { withTriggers } from "../convex/dbTriggers";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";

/**
 * The **workspace graph** query (CONTEXT.md).
 *
 * Two properties matter beyond "it returns the right picture":
 *  - it reads only the edge kinds it draws, so `belongs_to` — one row per task,
 *    the largest edge term — is never in the read set;
 *  - it builds tag nodes only when asked, because they cost three more
 *    whole-table scans and the UI hides them by default.
 */

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
    labels: ["alpha"],
  });
  return { t, workspaceId, asUser, projectId, taskId };
}

describe("graph.getWorkspaceGraph", () => {
  it("groups tasks under their project without emitting a belongs_to link", async () => {
    const { workspaceId, asUser, projectId, taskId } = await setup();

    const graph = await asUser.query(api.graph.getWorkspaceGraph, { workspaceId });

    // Containment travels as `groupId`; the client re-synthesises the line.
    expect(graph.nodes.find((n) => n.id === taskId)?.groupId).toBe(projectId);
    expect(graph.links.some((l) => l.edgeType === "belongs_to")).toBe(false);
  });

  it("omits tag nodes and tagged_with links by default", async () => {
    const { workspaceId, asUser } = await setup();

    const graph = await asUser.query(api.graph.getWorkspaceGraph, { workspaceId });

    expect(graph.nodes.some((n) => n.type === "tag")).toBe(false);
    expect(graph.links.some((l) => l.edgeType === "tagged_with")).toBe(false);
  });

  it("includes tag nodes and tagged_with links when asked", async () => {
    const { workspaceId, asUser, taskId } = await setup();

    const graph = await asUser.query(api.graph.getWorkspaceGraph, {
      workspaceId,
      includeTags: true,
    });

    const tagNodes = graph.nodes.filter((n) => n.type === "tag");
    expect(tagNodes).toHaveLength(1);
    expect(tagNodes[0].name).toBe("alpha");
    expect(
      graph.links.some(
        (l) => l.edgeType === "tagged_with" && l.source === taskId && l.target === tagNodes[0].id,
      ),
    ).toBe(true);
  });

  it("draws mention edges", async () => {
    const { t, workspaceId, asUser } = await setup();
    const channelId = await asUser.mutation(api.channels.create, {
      workspaceId,
      name: "general",
      visibility: ChannelVisibility.PUBLIC,
    });
    const mentioned = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Alice", email: "alice@test.com" }),
    );
    // Through a trigger-aware writer: the `user` node is created by the
    // `workspaceMembers` insert trigger, and the graph only draws a link when
    // both endpoints have nodes. A raw `t.run` insert fires no triggers.
    await t.run(async (ctx) =>
      withTriggers(ctx).db.insert("workspaceMembers", {
        workspaceId,
        userId: mentioned,
        role: WorkspaceRole.MEMBER,
      }),
    );
    await asUser.mutation(api.messages.send, {
      isomorphicId: "g1",
      body: JSON.stringify([
        { type: "paragraph", content: [{ type: "userMention", props: { userId: mentioned } }] },
      ]),
      plainText: "@Alice",
      channelId,
    });

    const graph = await asUser.query(api.graph.getWorkspaceGraph, { workspaceId });
    expect(
      graph.links.some(
        (l) => l.edgeType === "mentions" && l.source === channelId && l.target === mentioned,
      ),
    ).toBe(true);
  });

  it("returns an empty graph to a non-member", async () => {
    const { t, workspaceId } = await setup();
    const { asUser: outsider } = await setupAuthenticatedUser(t, {
      email: "outsider@example.com",
    });

    const graph = await outsider.query(api.graph.getWorkspaceGraph, { workspaceId });
    expect(graph).toEqual({ nodes: [], links: [] });
  });
});
