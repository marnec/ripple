import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("users.getByIds", () => {
  it("exposes the isBot field so the frontend can branch on bot identity", async () => {
    const t = createTestContext();
    const { userId, asUser } = await setupWorkspaceWithAdmin(t);
    const botUserId = await t.run((ctx) =>
      ctx.db.insert("users", { name: "GitHub", isBot: true }),
    );

    const result = await asUser.query(api.users.getByIds, {
      ids: [userId, botUserId],
    });

    expect(result[userId]?.isBot).toBeUndefined();
    expect(result[botUserId]?.isBot).toBe(true);
  });
});
