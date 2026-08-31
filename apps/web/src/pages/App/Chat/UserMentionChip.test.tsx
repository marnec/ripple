import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Doc } from "@convex/_generated/dataModel";
import { UserContext } from "@/pages/App/UserContext";
import { UserMentionChip } from "./UserMentionChip";

const createDm = vi.fn();
const findDmWith = vi.fn();
const navigate = vi.fn();
const toastError = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: () => createDm,
  useConvex: () => ({ query: findDmWith }),
}));
vi.mock("sonner", () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

// The confirm step arrives as a dialog on desktop and a drawer on mobile, and
// `ResponsiveDialog` asks which one it is. jsdom ships no `matchMedia`; the
// reference below is only tested for presence, never detached and called, so
// there is no `this` to lose.
// eslint-disable-next-line @typescript-eslint/unbound-method
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia;

beforeEach(() => {
  createDm.mockReset();
  findDmWith.mockReset();
  navigate.mockReset();
  toastError.mockReset();
});
afterEach(cleanup);

const viewer = { _id: "me" } as Doc<"users">;

/** The chip only ever renders inside a workspace route, which is where it
 *  reads the workspace from. */
function renderChip(
  userId: string,
  options: { viewer?: Doc<"users"> | null; interactive?: boolean } = {},
) {
  return render(
    <UserContext.Provider value={options.viewer ?? viewer}>
      <MemoryRouter initialEntries={["/workspaces/w1/channels/c1"]}>
        <Routes>
          <Route
            path="/workspaces/:workspaceId/channels/:channelId"
            element={
              <UserMentionChip
                userId={userId}
                name="Ana Ferreira"
                interactive={options.interactive}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    </UserContext.Provider>,
  );
}

describe("clicking a mention of someone you already talk to", () => {
  it("goes straight to the conversation, with nothing to confirm", async () => {
    findDmWith.mockResolvedValue("dm-channel");
    createDm.mockResolvedValue("dm-channel");
    renderChip("ana");

    await userEvent.click(screen.getByRole("button", { name: /Ana Ferreira/ }));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/workspaces/w1/channels/dm-channel"),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("clicking a mention of someone you do not talk to yet", () => {
  it("asks first, because the new channel shows up in their sidebar", async () => {
    findDmWith.mockResolvedValue(null);
    renderChip("ana");

    await userEvent.click(screen.getByRole("button", { name: /Ana Ferreira/ }));

    expect(await screen.findByText("Message Ana Ferreira?")).toBeTruthy();
    // Nothing has been created and nowhere has been navigated on the ask alone.
    expect(createDm).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("creates the conversation and goes there once confirmed", async () => {
    findDmWith.mockResolvedValue(null);
    createDm.mockResolvedValue("new-channel");
    renderChip("ana");

    await userEvent.click(screen.getByRole("button", { name: /Ana Ferreira/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Start conversation" }));

    await waitFor(() =>
      expect(createDm).toHaveBeenCalledWith({ workspaceId: "w1", otherUserId: "ana" }),
    );
    expect(navigate).toHaveBeenCalledWith("/workspaces/w1/channels/new-channel");
  });
});

describe("when the conversation cannot be reached", () => {
  it("says so and stays put", async () => {
    findDmWith.mockRejectedValue(new Error("not a member"));
    renderChip("ana");

    await userEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("how a mention reads", () => {
  it("is a neutral tint for someone else, so it does not fight the bubble", () => {
    findDmWith.mockResolvedValue(null);
    renderChip("ana");

    const chip = screen.getByRole("button");
    expect(chip.className).toContain("bg-foreground/10");
    // No text colour of its own: it inherits the bubble's foreground.
    expect(chip.className).not.toContain("text-background");
  });

  it("inverts for you, because nothing else says the message is yours", () => {
    renderChip("me");

    const chip = screen.getByTitle("Ana Ferreira");
    expect(chip.className).toContain("bg-foreground");
    expect(chip.className).toContain("text-background");
  });

  it("is not a link to a conversation with yourself", () => {
    renderChip("me");

    expect(screen.queryByRole("button")).toBeNull();
    expect(findDmWith).not.toHaveBeenCalled();
  });

  it("is inert in the composer, so a click lands the caret", () => {
    renderChip("ana", { interactive: false });

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTitle("Ana Ferreira")).toBeTruthy();
  });
});
