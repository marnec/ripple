import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineTitleField } from "./InlineTitleField";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

afterEach(cleanup);

function field(onCommit: (name: string) => Promise<unknown> | void, value = "Roadmap") {
  render(<InlineTitleField value={value} onCommit={onCommit} ariaLabel="Name" />);
  return screen.getByRole("textbox", { name: "Name" });
}

describe("InlineTitleField", () => {
  it("commits the trimmed name on Enter", () => {
    const onCommit = vi.fn();
    const input = field(onCommit);

    fireEvent.change(input, { target: { value: "  Roadmap 2027  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledExactlyOnceWith("Roadmap 2027");
    expect(input).toHaveValue("Roadmap 2027");
  });

  it("reverts on Escape without committing", () => {
    const onCommit = vi.fn();
    const input = field(onCommit);

    fireEvent.change(input, { target: { value: "Abandoned" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);

    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveValue("Roadmap");
  });

  it("commits nothing for an empty or unchanged name", () => {
    const onCommit = vi.fn();
    const input = field(onCommit);

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(input).toHaveValue("Roadmap");

    fireEvent.change(input, { target: { value: "Roadmap" } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("falls back to the server's name when the rename is rejected", async () => {
    const input = field(() => Promise.reject(new Error("Name taken")));

    fireEvent.change(input, { target: { value: "Taken" } });
    fireEvent.blur(input);

    await waitFor(() => expect(input).toHaveValue("Roadmap"));
  });

  it("reverts without a second toast when the commit reports its own failure", async () => {
    const input = field(() => Promise.resolve(false));

    fireEvent.change(input, { target: { value: "Not saved" } });
    fireEvent.blur(input);

    await waitFor(() => expect(input).toHaveValue("Roadmap"));
  });

  it("follows a rename made elsewhere", () => {
    const { rerender } = render(
      <InlineTitleField value="Roadmap" onCommit={() => {}} ariaLabel="Other" />,
    );
    rerender(<InlineTitleField value="Renamed by a colleague" onCommit={() => {}} ariaLabel="Other" />);

    expect(screen.getByRole("textbox", { name: "Other" })).toHaveValue("Renamed by a colleague");
  });
});
