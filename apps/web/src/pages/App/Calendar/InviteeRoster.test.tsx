/**
 * The roster's reason to exist: it renders rows from either invitee table.
 * `EventDetailContent.test.tsx` covers what it renders for a one-off event;
 * this covers the claim that a surface backed by `eventSeriesInvitees` can
 * hand its rows over unchanged.
 */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Doc, Id } from "@convex/_generated/dataModel";
import { InviteeRoster } from "./InviteeRoster";

/** A real series-roster row, so this stops compiling the day the two
 *  tables stop agreeing on what the roster reads. */
const seriesInvitee = (
  over: Partial<Doc<"eventSeriesInvitees">> = {},
): Doc<"eventSeriesInvitees"> => ({
  _id: "inv_series" as Id<"eventSeriesInvitees">,
  _creationTime: 0,
  seriesId: "ser_1" as Id<"eventSeries">,
  workspaceId: "ws_1" as Id<"workspaces">,
  userId: "u_alice" as Id<"users">,
  status: "accepted",
  ...over,
});

afterEach(cleanup);

describe("InviteeRoster", () => {
  it("renders a roster stored in the series table", async () => {
    // Typed, not `vi.fn()`: the roster hands the id back as the caller's own
    // `Id<…>`, and this array is what makes that a compile-time claim.
    const removed: Id<"eventSeriesInvitees">[] = [];
    render(
      <InviteeRoster
        invitees={[
          seriesInvitee(),
          seriesInvitee({
            _id: "inv_guest" as Id<"eventSeriesInvitees">,
            userId: undefined,
            guestEmail: "zoe@elsewhere.test",
            status: "pending",
          }),
        ]}
        editable
        members={[]}
        organizerId={"u_org" as Id<"users">}
        onAdd={vi.fn()}
        onRemove={(id) => {
          removed.push(id);
        }}
      />,
    );

    // Series rows carry no denormalised user name — the row still reads,
    // falling back the same way an event row does.
    expect(screen.getByText("Invitee")).toBeInTheDocument();
    expect(screen.getByText("Going")).toBeInTheDocument();
    expect(screen.getByText("zoe@elsewhere.test")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();

    // Series rows have no delivery columns at all; nothing is flagged.
    expect(screen.queryByLabelText("Delivery failed")).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Remove invitee" }),
    );
    expect(removed).toEqual(["inv_series"]);
  });

  it("offers no self-invite row to a roster that does not pass one", () => {
    render(
      <InviteeRoster
        invitees={[]}
        editable
        members={[]}
        organizerId={"u_org" as Id<"users">}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Add yourself as invitee" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("No one invited yet.")).toBeInTheDocument();
    // The adder is still there: editable is what gates it, not the slot.
    expect(
      screen.getByRole("button", { name: "Invite people" }),
    ).toBeInTheDocument();
  });
});
