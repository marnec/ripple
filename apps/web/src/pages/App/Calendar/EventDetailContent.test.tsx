/**
 * Characterisation tests for the invitee roster rendered by
 * `EventDetailContent` — the body both `EventDetailPage` and
 * `EventDetailSheet` render verbatim.
 *
 * They exist to pin the roster's behaviour while it is extracted into a
 * standalone component, so "nothing changes for the user" is a fact the
 * suite can check rather than a claim in a commit message.
 */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

// The member picker is a cmdk `Command`, which observes its list on mount.
// jsdom has no ResizeObserver and never resizes anything, so a no-op stands in.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
// …and scrolls its active item into view, which jsdom does not implement.
Object.defineProperty(Element.prototype, "scrollIntoView", {
  value: () => {},
  writable: true,
  configurable: true,
});

vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("convex-helpers/react/cache", () => ({ useQuery: () => [] }));

import { EventDetailContent } from "./EventDetailContent";

type Invitee = Record<string, unknown>;

const memberInvitee = (over: Invitee = {}): Invitee => ({
  _id: "inv_member",
  userId: "u_alice",
  userName: "Alice",
  userEmail: "alice@example.com",
  status: "accepted",
  ...over,
});

const renderContent = (
  over: {
    invitees?: Invitee[];
    editable?: boolean;
    viewerInvited?: boolean;
    props?: Record<string, unknown>;
  } = {},
) => {
  const detail = {
    event: {
      _id: "evt_1",
      createdBy: "u_org",
      startsAt: Date.parse("2026-03-04T10:00:00Z"),
      endsAt: Date.parse("2026-03-04T11:00:00Z"),
    },
    invitees: over.invitees ?? [],
    organizer: { userId: "u_org", name: "Olive" },
    channelName: undefined,
  };
  const props = {
    detail,
    channels: [],
    members: [],
    editable: over.editable ?? false,
    viewerInvited: over.viewerInvited ?? false,
    workspaceId: "ws_1",
    saveField: vi.fn(),
    handleAddInvitees: vi.fn(),
    handleSelfInvite: vi.fn(),
    handleRemoveInvitee: vi.fn(),
    ...over.props,
  };
  const Content = EventDetailContent as unknown as (
    p: Record<string, unknown>,
  ) => React.ReactNode;
  render(
    <MemoryRouter>
      <Content {...props} />
    </MemoryRouter>,
  );
  return props;
};

afterEach(cleanup);

describe("EventDetailContent invitees", () => {
  it("lists each invitee with their RSVP label, and the roster count", () => {
    renderContent({
      invitees: [
        memberInvitee(),
        memberInvitee({
          _id: "inv_bob",
          userId: "u_bob",
          userName: "Bob",
          userEmail: "bob@example.com",
          status: "declined",
        }),
      ],
    });

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Going")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Declined")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("says no one is invited yet when the roster is empty", () => {
    renderContent({ invitees: [] });

    expect(screen.getByText("No one invited yet.")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("offers the organiser a self-invite row until they are on the roster", async () => {
    const props = renderContent({ editable: true, viewerInvited: false });

    const ghost = screen.getByRole("button", {
      name: "Add yourself as invitee",
    });
    // The ghost row replaces the empty state rather than sitting beside it.
    expect(screen.queryByText("No one invited yet.")).not.toBeInTheDocument();

    await userEvent.click(ghost);
    expect(props.handleSelfInvite).toHaveBeenCalledTimes(1);

    cleanup();
    renderContent({
      editable: true,
      viewerInvited: true,
      invitees: [memberInvitee()],
    });
    expect(
      screen.queryByRole("button", { name: "Add yourself as invitee" }),
    ).not.toBeInTheDocument();
  });

  it("never offers the self-invite row to a non-organiser", () => {
    renderContent({ editable: false, viewerInvited: false });

    expect(
      screen.queryByRole("button", { name: "Add yourself as invitee" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("No one invited yet.")).toBeInTheDocument();
  });

  it("distinguishes a guest row from a member row", () => {
    renderContent({
      invitees: [
        memberInvitee(),
        {
          _id: "inv_guest",
          guestEmail: "zoe@elsewhere.test",
          status: "pending",
        },
      ],
    });

    // Member: their address is the subtitle, no guest marker.
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    // Guest: falls back to the address as the name, marked as a guest.
    expect(screen.getByText("zoe@elsewhere.test")).toBeInTheDocument();
    expect(screen.getByText("guest")).toBeInTheDocument();
    expect(screen.getByText("Guest")).toBeInTheDocument();
  });

  it("lets an organiser remove an invitee, and shows nobody else the control", async () => {
    const props = renderContent({
      editable: true,
      viewerInvited: true,
      invitees: [memberInvitee()],
    });

    await userEvent.click(screen.getByRole("button", { name: "Remove Alice" }));
    expect(props.handleRemoveInvitee).toHaveBeenCalledWith("inv_member");

    cleanup();
    renderContent({ editable: false, invitees: [memberInvitee()] });
    expect(
      screen.queryByRole("button", { name: "Remove Alice" }),
    ).not.toBeInTheDocument();
  });

  it("flags an invite whose mail never arrived, and only that one", () => {
    renderContent({
      invitees: [
        memberInvitee({ deliveryStatus: "delivered" }),
        {
          _id: "inv_guest",
          guestEmail: "typo@nowhere.test",
          status: "pending",
          deliveryStatus: "bounced",
          deliveryError: "Mailbox does not exist",
        },
      ],
    });

    const notices = screen.getAllByLabelText("Delivery failed");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toHaveAttribute(
      "title",
      "Delivery failed · Mailbox does not exist",
    );
  });

  it("adds a guest by email, ignoring an address already on the roster", async () => {
    const props = renderContent({
      editable: true,
      viewerInvited: true,
      invitees: [
        { _id: "inv_guest", guestEmail: "zoe@elsewhere.test", status: "pending" },
      ],
    });

    await userEvent.click(screen.getByRole("button", { name: "Invite people" }));

    const field = screen.getByPlaceholderText("Add guest by email");
    const add = screen.getByRole("button", { name: "Add guest email" });

    // Already invited — the adder drops it, so nothing is queued.
    await userEvent.type(field, "zoe@elsewhere.test");
    await userEvent.click(add);
    expect(screen.getByRole("button", { name: /^Add$/ })).toBeDisabled();

    await userEvent.type(field, "new@elsewhere.test");
    await userEvent.click(add);
    await userEvent.click(screen.getByRole("button", { name: "Add 1 person" }));

    expect(props.handleAddInvitees).toHaveBeenCalledWith(
      [],
      ["new@elsewhere.test"],
    );
  });

  it("offers only workspace members who are neither the organiser nor invited", async () => {
    renderContent({
      editable: true,
      viewerInvited: true,
      invitees: [memberInvitee()],
      props: {
        members: [
          { userId: "u_org", name: "Olive" },
          { userId: "u_alice", name: "Alice" },
          { userId: "u_bob", name: "Bob" },
        ],
      },
    });

    await userEvent.click(screen.getByRole("button", { name: "Invite people" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Add workspace members" }),
    );

    // Bob is the only option. Olive and Alice appear exactly once each —
    // in the Organizer section and on the roster row respectively — which
    // is how we know neither was also offered as someone to invite.
    expect(await screen.findByText("Bob")).toBeInTheDocument();
    expect(screen.getAllByText("Olive")).toHaveLength(1);
    expect(screen.getAllByText("Alice")).toHaveLength(1);
  });
});
