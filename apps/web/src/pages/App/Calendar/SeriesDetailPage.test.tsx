/**
 * The series page as the way in to its roster.
 *
 * Invite someone once and they are invited to all of it — so the roster is on
 * the *series*, and these tests read it through the page an organizer actually
 * opens rather than through the component it mounts. `InviteeRoster.test.tsx`
 * already proves that component renders `eventSeriesInvitees` rows; what is
 * unproven, and what a reviewer would want pinned, is that the series surface
 * mounts it, feeds it the series' own roster, and sends its edits to the
 * series' own mutations.
 */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  getFunctionName,
  type FunctionReference,
  type FunctionReturnType,
} from "convex/server";
import { ConvexError } from "convex/values";
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

const { queryAnswers, mutationCalls, toasts } = vi.hoisted(() => ({
  queryAnswers: new Map<string, unknown>(),
  mutationCalls: [] as { name: string; args: unknown }[],
  toasts: [] as { kind: string; message: string; description?: string }[],
}));

// Both mocks key on the function's *name*: Convex's `api` proxy hands back a
// fresh object on every property access, so `===` never holds.
vi.mock("convex-helpers/react/cache", () => ({
  useQuery: (ref: FunctionReference<"query">, args: unknown) =>
    args === "skip" ? undefined : queryAnswers.get(getFunctionName(ref)),
}));
vi.mock("convex/react", () => ({
  useMutation: (ref: FunctionReference<"mutation">) => {
    const name = getFunctionName(ref);
    return (args: unknown) => {
      mutationCalls.push({ name, args });
      const rejection = queryAnswers.get(`reject:${name}`);
      return rejection instanceof Error
        ? Promise.reject(rejection)
        : Promise.resolve(null);
    };
  },
}));
vi.mock("sonner", () => ({
  toast: {
    success: (message: string, opts?: { description?: string }) => {
      toasts.push({ kind: "success", message, description: opts?.description });
    },
    error: (message: string, opts?: { description?: string }) => {
      toasts.push({ kind: "error", message, description: opts?.description });
    },
  },
}));

import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { UserContext } from "@/pages/App/UserContext";
import { SeriesDetailPage } from "./SeriesDetailPage";

const WORKSPACE_ID = "ws_1" as Id<"workspaces">;
const SERIES_ID = "ser_1" as Id<"eventSeries">;
const ORGANIZER_ID = "u_org" as Id<"users">;

const SERIES = {
  _id: SERIES_ID,
  workspaceId: WORKSPACE_ID,
  title: "Standup",
  createdBy: ORGANIZER_ID,
  anchorDate: "2026-09-01",
  anchorTime: "09:00",
  durationMs: 30 * 60 * 1000,
  timezone: "Europe/Rome",
  rule: {
    freq: "weekly",
    interval: 1,
    weekdays: ["tuesday"],
    end: { kind: "never" },
  },
  tags: [],
};

/** A row exactly as `eventSeries.listInvitees` hands it over — the stored row
 *  plus the user fields that query denormalises onto member rows. Taken from
 *  the query's own return type, so these fixtures stop compiling the day the
 *  page and the roster stop agreeing on what a row is. */
type RosterRow = FunctionReturnType<
  typeof api.eventSeries.listInvitees
>[number];

const invitee = (over: Partial<RosterRow> = {}): RosterRow => ({
  _id: "inv_1" as Id<"eventSeriesInvitees">,
  _creationTime: 0,
  seriesId: SERIES_ID,
  workspaceId: WORKSPACE_ID,
  status: "pending",
  ...over,
});

function renderSeriesPage(
  over: {
    viewerId?: Id<"users">;
    invitees?: unknown[];
    members?: unknown[];
    /** Leave `eventSeries.listInvitees` unanswered, as it is on first paint. */
    rosterLoading?: boolean;
  } = {},
) {
  queryAnswers.clear();
  mutationCalls.length = 0;
  toasts.length = 0;
  queryAnswers.set("eventSeries:get", SERIES);
  if (!over.rosterLoading) {
    queryAnswers.set("eventSeries:listInvitees", over.invitees ?? []);
  }
  queryAnswers.set("workspaceMembers:membersWithRoles", over.members ?? []);
  queryAnswers.set("tags:listWorkspaceTags", []);

  const viewer = { _id: over.viewerId ?? ORGANIZER_ID } as Doc<"users">;
  return render(
    <UserContext.Provider value={viewer}>
      <MemoryRouter
        initialEntries={[`/workspaces/${WORKSPACE_ID}/events/${SERIES_ID}/series`]}
      >
        <Routes>
          <Route
            path="/workspaces/:workspaceId/events/:eventId/series"
            element={<SeriesDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    </UserContext.Provider>,
  );
}

afterEach(cleanup);

describe("the series roster", () => {
  it("shows who is on it and what each of them answered", () => {
    renderSeriesPage({
      invitees: [
        invitee({
          userId: "u_alice" as Id<"users">,
          status: "accepted",
          userName: "Alice",
          userEmail: "alice@example.com",
        }),
        invitee({
          _id: "inv_2" as Id<"eventSeriesInvitees">,
          guestEmail: "zoe@elsewhere.test",
          status: "declined",
        }),
      ],
    });

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Going")).toBeInTheDocument();
    // A guest reads as a guest, exactly as on a one-off event.
    expect(screen.getByText("zoe@elsewhere.test")).toBeInTheDocument();
    expect(screen.getByText("Guest")).toBeInTheDocument();
    expect(screen.getByText("Declined")).toBeInTheDocument();
  });

  it("adds a member and a guest to the series, not to one occurrence", async () => {
    renderSeriesPage({
      members: [
        { userId: ORGANIZER_ID, name: "Olive" },
        { userId: "u_bob", name: "Bob" },
      ],
    });

    await userEvent.click(screen.getByRole("button", { name: "Invite people" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Add workspace members" }),
    );
    await userEvent.click(await screen.findByText("Bob"));
    await userEvent.type(
      screen.getByPlaceholderText("Add guest by email"),
      "zoe@elsewhere.test",
    );
    await userEvent.click(screen.getByRole("button", { name: "Add guest email" }));
    await userEvent.click(screen.getByRole("button", { name: "Add 2 people" }));

    // `seriesId`, and nothing that names an occurrence: the guest's single
    // invitation carries the whole repeating pattern, and someone added in
    // week six is invited to all of what remains.
    expect(mutationCalls).toEqual([
      {
        name: "eventSeries:addInvitees",
        args: {
          seriesId: SERIES_ID,
          userIds: ["u_bob"],
          guestEmails: ["zoe@elsewhere.test"],
        },
      },
    ]);
    expect(toasts).toEqual([{ kind: "success", message: "Invited 2 people" }]);
  });

  it("removes someone from the whole series in one action", async () => {
    renderSeriesPage({
      invitees: [invitee({ userId: "u_alice" as Id<"users">, userName: "Alice" })],
    });

    await userEvent.click(screen.getByRole("button", { name: "Remove Alice" }));

    // One call, naming the roster row and no occurrence — the row was never
    // filed under one to begin with, so removing it removes her from all of it.
    expect(mutationCalls).toEqual([
      { name: "eventSeries:removeInvitee", args: { inviteeId: "inv_1" } },
    ]);
  });

  it("says why an add was refused instead of failing silently", async () => {
    renderSeriesPage({ members: [{ userId: "u_bob", name: "Bob" }] });
    queryAnswers.set(
      "reject:eventSeries:addInvitees",
      new ConvexError("Cannot invite more than 200 people"),
    );

    await userEvent.click(screen.getByRole("button", { name: "Invite people" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Add workspace members" }),
    );
    await userEvent.click(await screen.findByText("Bob"));
    await userEvent.click(screen.getByRole("button", { name: "Add 1 person" }));

    // The cap is the server's, so the only thing the organizer can be told is
    // what the server said. Swallowing it would leave an add that looks like
    // it worked and did nothing.
    expect(toasts).toEqual([
      {
        kind: "error",
        message: "Could not add invitees",
        description: "Cannot invite more than 200 people",
      },
    ]);
  });

  it("is read-only for anyone who is not the organizer", () => {
    renderSeriesPage({
      viewerId: "u_alice" as Id<"users">,
      invitees: [invitee({ userId: "u_alice" as Id<"users">, userName: "Alice" })],
      members: [{ userId: "u_bob", name: "Bob" }],
    });

    // A colleague still *sees* the roster — it is workspace-scoped, like the
    // series itself — but has no control that could change it.
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Invite people" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove Alice" }),
    ).not.toBeInTheDocument();
  });

  it("records the invitee's answer against the series, not one occurrence", async () => {
    renderSeriesPage({
      viewerId: "u_alice" as Id<"users">,
      invitees: [
        invitee({
          userId: "u_alice" as Id<"users">,
          userName: "Alice",
          status: "pending",
        }),
      ],
    });

    await userEvent.click(screen.getByRole("button", { name: "Going" }));

    // A `seriesId` and a status, and nothing that names a date: there is one
    // answer for the ritual and it covers every Tuesday of it.
    expect(mutationCalls).toEqual([
      {
        name: "eventSeries:respond",
        args: { seriesId: SERIES_ID, status: "accepted" },
      },
    ]);
  });

  it("lets the organizer put themselves on it in one click", async () => {
    renderSeriesPage();

    await userEvent.click(
      screen.getByRole("button", { name: "Add yourself as invitee" }),
    );

    // The series, and nothing naming an occurrence: the organizer is joining
    // the ritual, not one Tuesday of it.
    expect(mutationCalls).toEqual([
      { name: "eventSeries:selfInvite", args: { seriesId: SERIES_ID } },
    ]);
    // The server notifies nobody about this, the organizer included, so the
    // toast is the only acknowledgement the click ever gets.
    expect(toasts).toEqual([
      { kind: "success", message: "Added you as an invitee" },
    ]);
  });

  it("says why joining was refused instead of failing silently", async () => {
    renderSeriesPage();
    queryAnswers.set(
      "reject:eventSeries:selfInvite",
      new ConvexError("Cannot invite more than 200 people"),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Add yourself as invitee" }),
    );

    // The shortcut is counted against the same cap as any other invitation, so
    // it can be refused — and a button that quietly did nothing is the one
    // outcome an organizer cannot tell apart from success.
    expect(toasts).toEqual([
      {
        kind: "error",
        message: "Could not add you as invitee",
        description: "Cannot invite more than 200 people",
      },
    ]);
  });

  it("offers no answer to a colleague who is not on the roster", () => {
    renderSeriesPage({
      viewerId: "u_bystander" as Id<"users">,
      invitees: [
        invitee({ userId: "u_alice" as Id<"users">, userName: "Alice" }),
      ],
    });

    // The series is workspace-readable, so a bystander can look at it — but
    // they were not asked, so there is nothing here for them to answer. The
    // server refuses one anyway; this is so they are never offered it.
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Going" }),
    ).not.toBeInTheDocument();
  });

  it("offers no answer to the organizer, who is not answering their own invitation", () => {
    renderSeriesPage({
      invitees: [
        invitee({ userId: ORGANIZER_ID, userName: "Olive" }),
        invitee({
          _id: "inv_2" as Id<"eventSeriesInvitees">,
          userId: "u_alice" as Id<"users">,
          userName: "Alice",
        }),
      ],
    });

    // Same rule a one-off event applies: the organizer holds the invitation
    // list, they are not on the receiving end of it — even when they have put
    // themselves on the roster to hold the slot in their own calendar.
    expect(
      screen.queryByRole("button", { name: "Going" }),
    ).not.toBeInTheDocument();
  });

  it("stops offering that once the organizer is on it", () => {
    renderSeriesPage({
      invitees: [invitee({ userId: ORGANIZER_ID, status: "accepted" })],
    });

    // The affordance is the whole state indicator: offered while they are off
    // the roster, gone once they are on it. There is no second click to make.
    expect(
      screen.queryByRole("button", { name: "Add yourself as invitee" }),
    ).not.toBeInTheDocument();
  });

  it("offers it again if the organizer takes themselves back off", () => {
    // Same page, roster now empty again — the ghost row returns, so leaving is
    // reversible rather than a door that locks behind them.
    renderSeriesPage({ invitees: [] });

    expect(
      screen.getByRole("button", { name: "Add yourself as invitee" }),
    ).toBeInTheDocument();
  });

  it("offers it to nobody but the organizer", () => {
    renderSeriesPage({
      viewerId: "u_alice" as Id<"users">,
      invitees: [invitee({ userId: "u_alice" as Id<"users">, userName: "Alice" })],
    });

    // A colleague is already on the roster by someone else's decision, and the
    // shortcut was never theirs to use — the server refuses it too.
    expect(
      screen.queryByRole("button", { name: "Add yourself as invitee" }),
    ).not.toBeInTheDocument();
  });

  it("says nothing about the roster until it has one", () => {
    // The series arrives before its roster does — two queries, not one. "No
    // one invited yet" is a claim, and for the moment before the roster lands
    // it is the wrong one, so the section waits instead of guessing.
    renderSeriesPage({ rosterLoading: true });

    expect(screen.queryByText("Invitees")).not.toBeInTheDocument();
    expect(screen.queryByText("No one invited yet.")).not.toBeInTheDocument();
    // The rest of the page is not held up waiting for it.
    expect(screen.getByText("Standup")).toBeInTheDocument();
  });
});
