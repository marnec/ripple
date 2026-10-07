import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sheet, SheetContent, SheetTitle } from "./sheet";

afterEach(cleanup);

function sheet() {
  const onOpenChange = vi.fn();
  render(
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetTitle>Task</SheetTitle>
        <input aria-label="Title" />
        <div data-testid="handled" onKeyDown={(e) => e.key === "Escape" && e.preventDefault()}>
          <button type="button">Inside an editor that handles Escape</button>
        </div>
        <button type="button">Plain control</button>
      </SheetContent>
    </Sheet>,
  );
  return onOpenChange;
}

describe("Sheet escape", () => {
  it("blurs a focused text field instead of closing", () => {
    const onOpenChange = sheet();
    const input = screen.getByRole("textbox", { name: "Title" });
    input.focus();

    fireEvent.keyDown(input, { key: "Escape" });

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(input);
  });

  it("stays open when something inside already handled the Escape", () => {
    // BlockNote blurs itself (or closes its `/` menu) and prevents default.
    const onOpenChange = sheet();
    const inner = screen.getByRole("button", { name: /handles Escape/ });

    fireEvent.keyDown(inner, { key: "Escape" });

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("closes on Escape from anywhere else", () => {
    const onOpenChange = sheet();
    const plain = screen.getByRole("button", { name: "Plain control" });

    fireEvent.keyDown(plain, { key: "Escape" });

    expect(onOpenChange).toHaveBeenCalledWith(false, expect.objectContaining({ reason: "escape-key" }));
  });
});
