import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Doc } from "@convex/_generated/dataModel";
import { UserContext } from "@/pages/App/UserContext";
import { UserMentionChip } from "./UserMentionChip";

const createDm = vi.fn();
const navigate = vi.fn();
const toastError = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: () => createDm,
}));
vi.mock("sonner", () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

beforeEach(() => {
  createDm.mockReset();
  navigate.mockReset();
  toastError.mockReset();
});
afterEach(cleanup);

const viewer = { _id: "me" } as Doc<"users">;

/** The chip only ever renders inside a workspace route, which is where it
 *  reads the workspace from. */
function renderChip(userId: string, options: { viewer?: Doc<"users"> | null } = {}) {
  return render(
    <UserContext.Provider value={options.viewer ?? viewer}>
      <MemoryRouter initialEntries={["/workspaces/w1/channels/c1"]}>
        <Routes>
          <Route
            path="/workspaces/:workspaceId/channels/:channelId"
            element={<UserMentionChip userId={userId} name="Ana Ferreira" />}
          />
        </Routes>
      </MemoryRouter>
    </UserContext.Provider>,
  );
}

describe("a mention of someone else", () => {
  it("opens the conversation with them, creating it if there is none", async () => {
    createDm.mockResolvedValue("dm-channel");
    renderChip("ana");

    await userEvent.click(screen.getByRole("button", { name: /Ana Ferreira/ }));

    expect(createDm).toHaveBeenCalledWith({ workspaceId: "w1", otherUserId: "ana" });
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/workspaces/w1/channels/dm-channel"),
    );
  });

  it("says so and stays put when the conversation cannot be opened", async () => {
    createDm.mockRejectedValue(new Error("not a member"));
    renderChip("ana");

    await userEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
  });

  it("reads as a neutral tint so it does not fight the bubble it sits in", () => {
    renderChip("ana");

    const chip = screen.getByRole("button");
    expect(chip.className).toContain("bg-foreground/10");
    // No text colour of its own: it inherits the bubble's foreground.
    expect(chip.className).not.toContain("text-background");
  });
});

describe("a mention of you", () => {
  it("inverts to a filled chip, because nothing else says the message is yours", () => {
    renderChip("me");

    const chip = screen.getByTitle("Ana Ferreira");
    expect(chip.className).toContain("bg-foreground");
    expect(chip.className).toContain("text-background");
  });

  it("is not a link to a conversation with yourself", async () => {
    renderChip("me");

    expect(screen.queryByRole("button")).toBeNull();
    expect(createDm).not.toHaveBeenCalled();
  });
});

describe("a mention in the composer", () => {
  it("is inert, so a click lands the caret instead of navigating away", () => {
    render(
      <UserContext.Provider value={viewer}>
        <MemoryRouter initialEntries={["/workspaces/w1/channels/c1"]}>
          <Routes>
            <Route
              path="/workspaces/:workspaceId/channels/:channelId"
              element={
                <UserMentionChip userId="ana" name="Ana Ferreira" interactive={false} />
              }
            />
          </Routes>
        </MemoryRouter>
      </UserContext.Provider>,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTitle("Ana Ferreira")).toBeTruthy();
  });
});
