/**
 * The series' own fields, on the occurrence surface that now holds them.
 *
 * The series used to have a page of its own (`/events/:id/series`) carrying the
 * roster and the tags while an occurrence carried the date and the pattern.
 * Nothing forced that split, and it cost the organizer a "View series" link
 * they had to know to follow, so both halves are on one surface now.
 *
 * What that merge has to keep honest is the thing these tests pin: an edit to
 * something only the series holds still *says* it is series-wide, through the
 * scope question, and still lands on the series' own mutations naming no
 * occurrence. `InviteeRoster.test.tsx` already proves the roster component
 * renders `eventSeriesInvitees` rows; what is unproven is that the occurrence
 * surface mounts it, feeds it the series' roster, asks the scope question, and
 * only then writes.
 */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { getFunctionName, type FunctionReference, type FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
      return rejection instanceof Error ? Promise.reject(rejection) : Promise.resolve(null);
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
import { OccurrenceDetailPage } from "./OccurrenceDetailPage";

const WORKSPACE_ID = "ws_1" as Id<"workspaces">;
const SERIES_ID = "ser_1" as Id<"eventSeries">;
const ORGANIZER_ID = "u_org" as Id<"users">;
const FIRST_TUESDAY = Date.UTC(2026, 8, 1, 7, 0);

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
 *  surface and the roster stop agreeing on what a row is. */
type RosterRow = FunctionReturnType<typeof api.eventSeries.listInvitees>[number];

const invitee = (over: Partial<RosterRow> = {}): RosterRow => ({
  _id: "inv_1" as Id<"eventSeriesInvitees">,
  _creationTime: 0,
  seriesId: SERIES_ID,
  workspaceId: WORKSPACE_ID,
  status: "pending",
  ...over,
});

function renderOccurrence(
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
  queryAnswers.set("eventSeries:countOverrides", 0);
  if (!over.rosterLoading) {
    queryAnswers.set("eventSeries:listInvitees", over.invitees ?? []);
  }
  queryAnswers.set("workspaceMembers:membersWithRoles", over.members ?? []);
  queryAnswers.set("tags:listWorkspaceTags", []);

  const viewer = { _id: over.viewerId ?? ORGANIZER_ID } as Doc<"users">;
  return render(
    <UserContext.Provider value={viewer}>
      <MemoryRouter>
        <OccurrenceDetailPage
          workspaceId={WORKSPACE_ID}
          seriesId={SERIES_ID}
          originalStartMs={FIRST_TUESDAY}
        />
      </MemoryRouter>
    </UserContext.Provider>,
  );
}

/** Answer the scope question the only way a series-only edit can be answered. */
async function confirmScope() {
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
}

beforeEach(() => {
  // The surface mounts a `ResponsiveDialog`, which asks whether the viewport is
  // mobile; jsdom ships no `matchMedia`, so this installs a stub when it is
  // missing. `unbound-method` fires on the `??=` read, but the reference is
  // only tested for presence and never detached and called.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(cleanup);

describe("the scope question a series-only edit is asked", () => {
  it("offers the whole series and nothing narrower", async () => {
    renderOccurrence({ members: [{ userId: "u_bob", name: "Bob" }] });

    await userEvent.click(screen.getByRole("button", { name: "Invite people" }));
    await userEvent.click(screen.getByRole("button", { name: "Add workspace members" }));
    await userEvent.click(await screen.findByText("Bob"));
    await userEvent.click(screen.getByRole("button", { name: "Add 1 person" }));

    // The two narrower answers are shown and refused rather than withheld: a
    // list that quietly shrinks leaves the organizer to guess whether the
    // option was taken away or never existed.
    expect(screen.getByRole("radio", { name: /This occurrence/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /This and following/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /All occurrences/ })).toBeEnabled();
    // Nothing has been written while the question is open.
    expect(mutationCalls).toEqual([]);
  });

  it("writes nothing when the question is dismissed", async () => {
    renderOccurrence({
      invitees: [invitee({ userId: "u_alice" as Id<"users">, userName: "Alice" })],
    });

    await userEvent.click(screen.getByRole("button", { name: "Remove Alice" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // Backing out of the question backs out of the edit — the removal was
    // never sent, so Alice is still on the roster.
    expect(mutationCalls).toEqual([]);
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });
});

describe("the series roster, from an occurrence", () => {
  it("shows who is on it and what each of them answered", () => {
    renderOccurrence({
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
    renderOccurrence({
      members: [
        { userId: ORGANIZER_ID, name: "Olive" },
        { userId: "u_bob", name: "Bob" },
      ],
    });

    await userEvent.click(screen.getByRole("button", { name: "Invite people" }));
    await userEvent.click(screen.getByRole("button", { name: "Add workspace members" }));
    await userEvent.click(await screen.findByText("Bob"));
    await userEvent.type(screen.getByPlaceholderText("Add guest by email"), "zoe@elsewhere.test");
    await userEvent.click(screen.getByRole("button", { name: "Add guest email" }));
    await userEvent.click(screen.getByRole("button", { name: "Add 2 people" }));
    await confirmScope();

    // `seriesId`, and nothing that names an occurrence: the guest's single
    // invitation carries the whole repeating pattern, and someone added in
    // week six is invited to all of what remains — which is exactly what the
    // scope question said before this was sent.
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
    renderOccurrence({
      invitees: [invitee({ userId: "u_alice" as Id<"users">, userName: "Alice" })],
    });

    await userEvent.click(screen.getByRole("button", { name: "Remove Alice" }));
    await confirmScope();

    // One call, naming the roster row and no occurrence — the row was never
    // filed under one to begin with, so removing it removes her from all of it.
    expect(mutationCalls).toEqual([
      { name: "eventSeries:removeInvitee", args: { inviteeId: "inv_1" } },
    ]);
  });

  it("says why an add was refused instead of failing silently", async () => {
    renderOccurrence({ members: [{ userId: "u_bob", name: "Bob" }] });
    queryAnswers.set(
      "reject:eventSeries:addInvitees",
      new ConvexError("Cannot invite more than 200 people"),
    );

    await userEvent.click(screen.getByRole("button", { name: "Invite people" }));
    await userEvent.click(screen.getByRole("button", { name: "Add workspace members" }));
    await userEvent.click(await screen.findByText("Bob"));
    await userEvent.click(screen.getByRole("button", { name: "Add 1 person" }));
    await confirmScope();

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
    renderOccurrence({
      viewerId: "u_alice" as Id<"users">,
      invitees: [invitee({ userId: "u_alice" as Id<"users">, userName: "Alice" })],
      members: [{ userId: "u_bob", name: "Bob" }],
    });

    // A colleague still *sees* the roster — it is workspace-scoped, like the
    // series itself — but has no control that could change it.
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invite people" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Alice" })).not.toBeInTheDocument();
  });

  it("lets the organizer put themselves on it in one click", async () => {
    renderOccurrence();

    await userEvent.click(screen.getByRole("button", { name: "Add yourself as invitee" }));
    await confirmScope();

    // The series, and nothing naming an occurrence: the organizer is joining
    // the ritual, not one Tuesday of it.
    expect(mutationCalls).toEqual([
      { name: "eventSeries:selfInvite", args: { seriesId: SERIES_ID } },
    ]);
    // The server notifies nobody about this, the organizer included, so the
    // toast is the only acknowledgement the click ever gets.
    expect(toasts).toEqual([{ kind: "success", message: "Added you as an invitee" }]);
  });

  it("says why joining was refused instead of failing silently", async () => {
    renderOccurrence();
    queryAnswers.set(
      "reject:eventSeries:selfInvite",
      new ConvexError("Cannot invite more than 200 people"),
    );

    await userEvent.click(screen.getByRole("button", { name: "Add yourself as invitee" }));
    await confirmScope();

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

  it("stops offering that once the organizer is on it", () => {
    renderOccurrence({
      invitees: [invitee({ userId: ORGANIZER_ID, status: "accepted" })],
    });

    // The affordance is the whole state indicator: offered while they are off
    // the roster, gone once they are on it. There is no second click to make.
    expect(
      screen.queryByRole("button", { name: "Add yourself as invitee" }),
    ).not.toBeInTheDocument();
  });

  it("offers it again if the organizer takes themselves back off", () => {
    // Same surface, roster now empty again — the ghost row returns, so leaving
    // is reversible rather than a door that locks behind them.
    renderOccurrence({ invitees: [] });

    expect(screen.getByRole("button", { name: "Add yourself as invitee" })).toBeInTheDocument();
  });

  it("offers it to nobody but the organizer", () => {
    renderOccurrence({
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
    renderOccurrence({ rosterLoading: true });

    expect(screen.queryByText("Invitees")).not.toBeInTheDocument();
    expect(screen.queryByText("No one invited yet.")).not.toBeInTheDocument();
    // The rest of the surface is not held up waiting for it.
    expect(screen.getByText("Standup")).toBeInTheDocument();
  });
});

describe("the series' tags, from an occurrence", () => {
  it("sends them to the series once the scope question is answered", async () => {
    renderOccurrence();

    await userEvent.type(screen.getByPlaceholderText("Add tags…"), "planning{Enter}");
    // The chip is already showing while the question is open — the pending set
    // is what the input is fed, so cancelling puts it back rather than leaving
    // a tag on screen that was never saved.
    expect(screen.getByText("planning")).toBeInTheDocument();
    expect(mutationCalls).toEqual([]);

    await confirmScope();

    expect(mutationCalls).toEqual([
      {
        name: "eventSeries:updateTags",
        args: { seriesId: SERIES_ID, tags: ["planning"] },
      },
    ]);
  });
});
