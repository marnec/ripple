import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { createTestContext, setupProject, setupWorkspaceWithAdmin } from "./helpers";

/**
 * `/ai/document` streams a model's edits for a document or a task description
 * and hands that model read tools over the workspace, so its gate must be the
 * workspace rule the document and task queries apply — the same one the
 * collaboration token and the snapshot URL apply. Everything before the model
 * call is exercised here; the model call itself is fenced off by leaving
 * `AZURE_API_KEY` unset, which the route reports as 503 once access has been
 * granted.
 */

const ORIGIN = "https://ripple.test";

function requestBody(documentId: string) {
  return bodyFor({ documentId });
}

function taskRequestBody(taskId: string) {
  return bodyFor({ taskId });
}

function bodyFor(target: { documentId?: string; taskId?: string }) {
  return JSON.stringify({
    ...target,
    messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] }],
    toolDefinitions: {
      applyDocumentOperations: {
        inputSchema: { type: "object", properties: {} },
        outputSchema: { type: "object" },
      },
    },
  });
}

const post = (body: string): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: ORIGIN },
  body,
});

describe("/ai/document access", () => {
  let savedKey: string | undefined;
  let savedSite: string | undefined;

  beforeEach(() => {
    savedKey = process.env.AZURE_API_KEY;
    savedSite = process.env.SITE_URL;
    delete process.env.AZURE_API_KEY;
    process.env.SITE_URL = ORIGIN;
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.AZURE_API_KEY;
    else process.env.AZURE_API_KEY = savedKey;
    if (savedSite === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = savedSite;
  });

  it("answers the browser's preflight for the configured site only", async () => {
    const t = createTestContext();
    const allowed = await t.fetch("/ai/document", {
      method: "OPTIONS",
      headers: { Origin: ORIGIN },
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(allowed.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");

    const other = await t.fetch("/ai/document", {
      method: "OPTIONS",
      headers: { Origin: "https://elsewhere.test" },
    });
    expect(other.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("rejects an unauthenticated caller before reading anything", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const documentId = await t.run((ctx) =>
      ctx.db.insert("documents", { workspaceId, name: "Secret" }),
    );
    const response = await t.fetch("/ai/document", post(requestBody(documentId)));
    expect(response.status).toBe(401);
  });

  it("rejects a malformed body", async () => {
    const t = createTestContext();
    const { asUser } = await setupWorkspaceWithAdmin(t);
    const response = await asUser.fetch("/ai/document", post(JSON.stringify({ hello: 1 })));
    expect(response.status).toBe(400);
  });

  it("denies a member of a different workspace", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t, "Owning Workspace");
    const documentId = await t.run((ctx) =>
      ctx.db.insert("documents", { workspaceId, name: "Confidential" }),
    );
    const { asUser: asOutsider } = await setupWorkspaceWithAdmin(t, "Other Workspace");

    const response = await asOutsider.fetch("/ai/document", post(requestBody(documentId)));
    expect(response.status).toBe(403);
  });

  it("denies an id that is not a document at all", async () => {
    const t = createTestContext();
    const { asUser } = await setupWorkspaceWithAdmin(t);
    const response = await asUser.fetch("/ai/document", post(requestBody("not-an-id")));
    expect(response.status).toBe(403);
  });

  it("lets a member through to the model, which is unconfigured here", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const documentId: Id<"documents"> = await t.run((ctx) =>
      ctx.db.insert("documents", { workspaceId, name: "Mine" }),
    );
    const response = await asUser.fetch("/ai/document", post(requestBody(documentId)));
    expect(response.status).toBe(503);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });
});

/** A task in a fresh project of `workspaceId`, owned by `creatorId`. */
async function insertTask(
  t: ReturnType<typeof createTestContext>,
  workspaceId: Id<"workspaces">,
  creatorId: Id<"users">,
  title: string,
): Promise<Id<"tasks">> {
  const projectId = await setupProject(t, { workspaceId, creatorId });
  return t.run(async (ctx) => {
    const statusId = await ctx.db.insert("taskStatuses", {
      projectId, name: "Todo", color: "bg-gray-500", order: 0, isDefault: true, isCompleted: false,
    });
    return ctx.db.insert("tasks", {
      projectId, workspaceId, title, statusId,
      priority: "medium", completed: false, creatorId,
    });
  });
}

describe("/ai/document access for a task description", () => {
  let savedKey: string | undefined;
  let savedSite: string | undefined;

  beforeEach(() => {
    savedKey = process.env.AZURE_API_KEY;
    savedSite = process.env.SITE_URL;
    delete process.env.AZURE_API_KEY;
    process.env.SITE_URL = ORIGIN;
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.AZURE_API_KEY;
    else process.env.AZURE_API_KEY = savedKey;
    if (savedSite === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = savedSite;
  });

  it("rejects a body that names both a document and a task", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const taskId = await insertTask(t, workspaceId, userId, "Both");
    const documentId = await t.run((ctx) =>
      ctx.db.insert("documents", { workspaceId, name: "Both" }),
    );
    const response = await asUser.fetch(
      "/ai/document",
      post(bodyFor({ documentId, taskId })),
    );
    expect(response.status).toBe(400);
  });

  it("denies a member of a different workspace", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t, "Owning Workspace");
    const taskId = await insertTask(t, workspaceId, userId, "Confidential");
    const { asUser: asOutsider } = await setupWorkspaceWithAdmin(t, "Other Workspace");

    const response = await asOutsider.fetch("/ai/document", post(taskRequestBody(taskId)));
    expect(response.status).toBe(403);
  });

  it("denies a document id sent as a task id", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const documentId = await t.run((ctx) =>
      ctx.db.insert("documents", { workspaceId, name: "Not a task" }),
    );
    const response = await asUser.fetch("/ai/document", post(taskRequestBody(documentId)));
    expect(response.status).toBe(403);
  });

  it("lets a member through to the model, which is unconfigured here", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const taskId = await insertTask(t, workspaceId, userId, "Mine");
    const response = await asUser.fetch("/ai/document", post(taskRequestBody(taskId)));
    expect(response.status).toBe(503);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });
});
