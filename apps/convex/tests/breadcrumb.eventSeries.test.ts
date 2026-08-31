/**
 * A breadcrumb over a series URL.
 *
 * `/workspaces/:ws/events/:id` carries a **series** id whenever the event is a
 * recurring one, so the crumb resolver is handed an id from a table it never
 * used to see. Getting this wrong is not a blank crumb: an id the argument
 * validator rejects fails the whole query, the breadcrumb throws into its
 * error boundary, and the boundary's re-render throws again — the page dies in
 * a render loop rather than losing a label.
 */
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";

const WEEKLY_STANDUP = {
  title: "Standup",
  anchorDate: "2026-09-01",
  anchorTime: "09:00",
  durationMs: 30 * 60 * 1000,
  timezone: "Europe/Rome",
  rule: {
    freq: "weekly" as const,
    interval: 1,
    weekdays: ["tuesday"],
    end: { kind: "never" as const },
  },
};

describe("breadcrumb names for a series", () => {
  it("resolves a series id to its title", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    const names = await asUser.query(api.breadcrumb.getResourceNames, {
      resourceIds: [seriesId],
    });

    expect(names[seriesId]).toBe("Standup");
  });

  it("tells a non-member nothing, the same as every other resource", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    const { asUser: asOutsider } = await setupAuthenticatedUser(t, {
      name: "Outsider",
      email: "outsider@example.com",
    });
    const names = await asOutsider.query(api.breadcrumb.getResourceNames, {
      resourceIds: [seriesId],
    });

    expect(names[seriesId]).toBeNull();
  });
});
