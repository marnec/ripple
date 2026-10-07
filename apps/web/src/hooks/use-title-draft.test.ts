import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTitleDraft } from "./use-title-draft";

describe("useTitleDraft", () => {
  it("shows the title of a task that is already loaded on first render", () => {
    // Regression: a cached task left the title field empty.
    const { result } = renderHook(() => useTitleDraft("Fix login"));
    expect(result.current[0]).toBe("Fix login");
  });

  it("picks up the title once the task loads", () => {
    const { result, rerender } = renderHook(({ title }) => useTitleDraft(title), {
      initialProps: { title: undefined as string | undefined },
    });
    expect(result.current[0]).toBe("");
    rerender({ title: "Fix login" });
    expect(result.current[0]).toBe("Fix login");
  });

  it("follows the server when the task changes or is renamed elsewhere", () => {
    const { result, rerender } = renderHook(({ title }) => useTitleDraft(title), {
      initialProps: { title: "Fix login" },
    });
    act(() => result.current[1]("Fix log"));
    rerender({ title: "Another task" });
    expect(result.current[0]).toBe("Another task");
  });

  it("keeps the user's edit while the server title is unchanged", () => {
    const { result, rerender } = renderHook(({ title }) => useTitleDraft(title), {
      initialProps: { title: "Fix login" },
    });
    act(() => result.current[1]("Fix login page"));
    rerender({ title: "Fix login" });
    expect(result.current[0]).toBe("Fix login page");
  });
});
