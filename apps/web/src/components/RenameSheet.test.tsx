import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { RenameSheet } from "./RenameSheet";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

beforeEach(() => vi.mocked(toast.error).mockClear());
afterEach(cleanup);

function sheet(onRename: (name: string) => Promise<unknown> | void) {
  const onOpenChange = vi.fn();
  render(
    <RenameSheet
      open
      onOpenChange={onOpenChange}
      value="Fix login"
      onRename={onRename}
      resourceLabel="task"
    />,
  );
  return { input: screen.getByRole("textbox", { name: "task name" }), onOpenChange };
}

describe("RenameSheet", () => {
  it("saves the trimmed name and closes", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    const { input, onOpenChange } = sheet(onRename);

    fireEvent.change(input, { target: { value: "  Fix login redirect  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onRename).toHaveBeenCalledExactlyOnceWith("Fix login redirect");
  });

  it("folds pasted newlines into spaces", () => {
    const { input } = sheet(vi.fn());

    fireEvent.change(input, { target: { value: "Fix\nlogin" } });

    expect(input).toHaveValue("Fix login");
  });

  it("closes without renaming when nothing changed", async () => {
    const onRename = vi.fn();
    const { onOpenChange } = sheet(onRename);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onRename).not.toHaveBeenCalled();
  });

  it("stays open with the draft when the rename is rejected", async () => {
    const { input, onOpenChange } = sheet(() => Promise.reject(new Error("Name taken")));

    fireEvent.change(input, { target: { value: "Taken" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(input).toHaveValue("Taken");
  });

  it("stays open without a second toast when the rename reports its own failure", async () => {
    const onRename = vi.fn().mockResolvedValue(false);
    const { input, onOpenChange } = sheet(onRename);

    fireEvent.change(input, { target: { value: "Not saved" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onRename).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
