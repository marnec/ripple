import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { createTaskPatch, taskDetailLoadState, type TaskPatch } from "./taskDetailModel";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const ready = { task: { _id: "t1" }, statuses: [], members: [] };

describe("taskDetailLoadState", () => {
  it("is 'deleted' once the task query resolves to null", () => {
    expect(taskDetailLoadState({ ...ready, task: null })).toBe("deleted");
  });

  it("reports 'deleted' even while the supporting queries are still in flight", () => {
    // The task is gone; waiting on statuses/members would strand the surface on
    // a spinner forever. This is the sheet's historic bug.
    expect(
      taskDetailLoadState({ task: null, statuses: undefined, members: undefined }),
    ).toBe("deleted");
  });

  it("is 'loading' until every query the surface needs has resolved", () => {
    expect(taskDetailLoadState({ ...ready, task: undefined })).toBe("loading");
    expect(taskDetailLoadState({ ...ready, statuses: undefined })).toBe("loading");
    expect(taskDetailLoadState({ ...ready, members: undefined })).toBe("loading");
  });

  it("is 'ready' when the task and its supporting queries have all arrived", () => {
    expect(taskDetailLoadState(ready)).toBe("ready");
  });
});

describe("createTaskPatch", () => {
  const taskId = "task_1" as never;

  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
  });

  it("forwards the patched fields verbatim alongside the task id", async () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    const patch = createTaskPatch({ taskId, updateTask });

    await patch({ priority: "high" });

    expect(updateTask).toHaveBeenCalledWith({ taskId, priority: "high" });
  });

  it("sends a multi-field patch as a single mutation", async () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    const patch = createTaskPatch({ taskId, updateTask });

    await patch({ dueDate: null, estimate: 3 });

    expect(updateTask).toHaveBeenCalledTimes(1);
    expect(updateTask).toHaveBeenCalledWith({ taskId, dueDate: null, estimate: 3 });
  });

  it("no-ops without a task id, so a surface with nothing selected cannot write", async () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    const patch = createTaskPatch({ taskId: null, updateTask });

    await patch({ priority: "low" });

    expect(updateTask).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("surfaces a rejection as exactly one toast instead of swallowing it", async () => {
    const updateTask = vi.fn().mockRejectedValue(new Error("Task is locked"));
    const patch = createTaskPatch({ taskId, updateTask });

    await patch({ priority: "high" });

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("Couldn't change priority", {
      description: "Task is locked",
    });
  });

  it("never rejects, so callers cannot produce an unhandled rejection", async () => {
    const updateTask = vi.fn().mockRejectedValue(new Error("nope"));
    const patch = createTaskPatch({ taskId, updateTask });

    await expect(patch({ title: "x" })).resolves.toBeUndefined();
  });

  it("names the field that failed, so every property gets the status field's old specificity", async () => {
    const cases: Array<[TaskPatch, string]> = [
      [{ statusId: "s1" as never }, "Couldn't change status"],
      [{ assigneeId: null }, "Couldn't change assignee"],
      [{ labels: [] }, "Couldn't update tags"],
      [{ dueDate: null }, "Couldn't change due date"],
      [{ plannedStartDate: null }, "Couldn't change start date"],
      [{ estimate: 1 }, "Couldn't change estimate"],
      [{ title: "t" }, "Couldn't rename task"],
    ];

    for (const [fields, message] of cases) {
      vi.mocked(toast.error).mockClear();
      const updateTask = vi.fn().mockRejectedValue(new Error("boom"));
      await createTaskPatch({ taskId, updateTask })(fields);
      expect(toast.error).toHaveBeenCalledWith(message, { description: "boom" });
    }
  });

  it("falls back to a generic message when a patch spans several fields", async () => {
    const updateTask = vi.fn().mockRejectedValue(new Error("boom"));
    const patch = createTaskPatch({ taskId, updateTask });

    await patch({ statusId: "s1" as never, priority: "high" });

    expect(toast.error).toHaveBeenCalledWith("Couldn't update task", {
      description: "boom",
    });
  });
});
