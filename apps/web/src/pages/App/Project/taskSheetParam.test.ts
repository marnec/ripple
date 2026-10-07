import { describe, expect, it } from "vitest";
import { sheetReturnHref } from "./taskSheetParam";

const base = { workspaceId: "w1", projectId: "p1", taskId: "t2" };

describe("sheetReturnHref", () => {
  it("returns to the origin surface, keeping its other params", () => {
    expect(
      sheetReturnHref({ ...base, returnTo: "/workspaces/w1/projects/p1/tasks?view=list&task=t1" }),
    ).toBe("/workspaces/w1/projects/p1/tasks?view=list&task=t2");
  });

  it("returns to the project overview (the project root)", () => {
    expect(sheetReturnHref({ ...base, returnTo: "/workspaces/w1/projects/p1?task=t2" })).toBe(
      "/workspaces/w1/projects/p1?task=t2",
    );
  });

  it("falls back to the tasks page with no origin", () => {
    expect(sheetReturnHref({ ...base, returnTo: undefined })).toBe(
      "/workspaces/w1/projects/p1/tasks?task=t2",
    );
  });

  it("falls back for an origin outside the task's project", () => {
    expect(sheetReturnHref({ ...base, returnTo: "/workspaces/w1/projects/p9/tasks?task=t2" })).toBe(
      "/workspaces/w1/projects/p1/tasks?task=t2",
    );
    expect(sheetReturnHref({ ...base, returnTo: "/workspaces/w1/projects/p10?view=list" })).toBe(
      "/workspaces/w1/projects/p1/tasks?task=t2",
    );
    expect(sheetReturnHref({ ...base, returnTo: "/workspaces/w1/my-calendar?task=t2" })).toBe(
      "/workspaces/w1/projects/p1/tasks?task=t2",
    );
  });

  it("never returns to a task page", () => {
    expect(sheetReturnHref({ ...base, returnTo: "/workspaces/w1/projects/p1/tasks/t1" })).toBe(
      "/workspaces/w1/projects/p1/tasks?task=t2",
    );
  });
});
