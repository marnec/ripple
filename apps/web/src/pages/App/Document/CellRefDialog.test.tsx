import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { CellRefDialog } from "./CellRefDialog";

/**
 * The dialog holds the ref the user is typing; whoever opened it holds the
 * spreadsheet. `rangeWarning` is the one question it asks back, and what
 * matters about it is that it describes rather than prevents: an empty range
 * is a legitimate thing to reference, so the warning must never stand between
 * the user and the insert.
 */

const SPREADSHEET_ID = "sheet1" as Id<"spreadsheets">;

function renderDialog(props: Partial<Parameters<typeof CellRefDialog>[0]> = {}) {
  const onInsert = vi.fn();
  render(
    <CellRefDialog
      open
      onOpenChange={vi.fn()}
      spreadsheetId={SPREADSHEET_ID}
      spreadsheetName="Budget"
      onInsert={onInsert}
      {...props}
    />,
  );
  return { onInsert };
}

afterEach(cleanup);

describe("CellRefDialog — range warning", () => {
  it("shows what the caller says about a ref once it is insertable", async () => {
    renderDialog({ rangeWarning: (ref) => `${ref} is empty` });

    await userEvent.type(screen.getByPlaceholderText("A1 or A1:C3"), "A1:B2");

    expect(await screen.findByText("A1:B2 is empty")).toBeTruthy();
  });

  it("still inserts — a warning is not a refusal", async () => {
    const { onInsert } = renderDialog({ rangeWarning: () => "A1:B2 is empty" });

    await userEvent.type(screen.getByPlaceholderText("A1 or A1:C3"), "A1:B2");
    await userEvent.click(screen.getByRole("button", { name: "Insert Reference" }));

    expect(onInsert).toHaveBeenCalledWith("A1:B2");
  });

  it("says nothing when the caller has nothing to say", async () => {
    renderDialog({ rangeWarning: () => null });

    await userEvent.type(screen.getByPlaceholderText("A1 or A1:C3"), "A1:B2");

    expect(screen.queryByText(/empty/)).toBeNull();
  });

  it("asks only about refs that would actually be inserted", async () => {
    const rangeWarning = vi.fn(() => "should not be asked");
    renderDialog({ rangeWarning });

    // Pasted rather than typed: typing passes through "A1", which *is* a ref
    // worth describing. What must not be described is the ref as it stands —
    // oversized here, and unparseable below. Each already has an error of its
    // own, and a warning on top would be noise about a failed insert.
    const input = screen.getByPlaceholderText("A1 or A1:C3");
    await userEvent.click(input);
    await userEvent.paste("A1:ZZ999");

    expect(rangeWarning).not.toHaveBeenCalled();
    expect(screen.queryByText("should not be asked")).toBeNull();

    await userEvent.clear(input);
    await userEvent.paste("nonsense");

    expect(rangeWarning).not.toHaveBeenCalled();
  });

  it("asks nothing while the caller cannot answer yet", async () => {
    const rangeWarning = vi.fn(() => "should not be asked");
    renderDialog({ rangeWarning, rangeReady: false });

    await userEvent.type(screen.getByPlaceholderText("A1 or A1:C3"), "A1:B2");

    expect(rangeWarning).not.toHaveBeenCalled();
  });

  it("normalises the ref it asks about", async () => {
    const rangeWarning = vi.fn(() => null);
    renderDialog({ rangeWarning });

    await userEvent.type(screen.getByPlaceholderText("A1 or A1:C3"), "a1:b2");

    expect(rangeWarning).toHaveBeenLastCalledWith("A1:B2");
  });
});
