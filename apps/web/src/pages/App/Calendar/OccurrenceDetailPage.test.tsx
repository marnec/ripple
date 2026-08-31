/**
 * An occurrence as the place an invitee actually answers from.
 *
 * The calendar links to a date, not to a pattern, so the occurrence is where
 * people land — and requiring them to find the series first would make
 * accepting harder than it is for the one-off event this replaces. What they
 * answer is still the *series*: these tests pin that the control on a Tuesday
 * sends a `seriesId` and no coordinate, and that a second Tuesday shows the
 * answer given on the first (spec 0003, "RSVP"; per-occurrence RSVP is
 * deliberately out of scope).
 */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryAnswers, mutationCalls } = vi.hoisted(() => ({
  queryAnswers: new Map<string, unknown>(),
  mutationCalls: [] as { name: string; args: unknown }[],
}));

// Keyed on the function's *name*: Convex's `api` proxy hands back a fresh
// object on every property access, so `===` never holds.
vi.mock("convex-helpers/react/cache", () => ({
  useQuery: (ref: FunctionReference<"query">, args: unknown) =>
    args === "skip" ? undefined : queryAnswers.get(getFunctionName(ref)),
}));
vi.mock("convex/react", () => ({
  useMutation: (ref: FunctionReference<"mutation">) => {
    const name = getFunctionName(ref);
    return (args: unknown) => {
      mutationCalls.push({ name, args });
      return Promise.resolve(null);
    };
  },
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import type { Doc, Id } from "@convex/_generated/dataModel";
import { UserContext } from "@/pages/App/UserContext";
import { OccurrenceDetailPage } from "./OccurrenceDetailPage";

const WORKSPACE_ID = "ws_1" as Id<"workspaces">;
const SERIES_ID = "ser_1" as Id<"eventSeries">;
const ORGANIZER_ID = "u_org" as Id<"users">;
const ALICE_ID = "u_alice" as Id<"users">;

/** Two Tuesdays of the same weekly standup, a week apart. */
const FIRST_TUESDAY = Date.UTC(2026, 8, 1, 7, 0);
const SECOND_TUESDAY = FIRST_TUESDAY + 7 * 24 * 60 * 60 * 1000;

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

function renderOccurrence(
  over: {
    viewerId?: Id<"users">;
    invitees?: unknown[];
    originalStartMs?: number;
  } = {},
) {
  queryAnswers.clear();
  mutationCalls.length = 0;
  queryAnswers.set("eventSeries:get", SERIES);
  queryAnswers.set("eventSeries:countOverrides", 0);
  queryAnswers.set("eventSeries:listInvitees", over.invitees ?? []);

  const viewer = { _id: over.viewerId ?? ORGANIZER_ID } as Doc<"users">;
  return render(
    <UserContext.Provider value={viewer}>
      <MemoryRouter>
        <OccurrenceDetailPage
          workspaceId={WORKSPACE_ID}
          seriesId={SERIES_ID}
          originalStartMs={over.originalStartMs ?? FIRST_TUESDAY}
        />
      </MemoryRouter>
    </UserContext.Provider>,
  );
}

beforeEach(() => {
  // The page mounts a `ResponsiveDialog`, which asks whether the viewport is
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

describe("answering from an occurrence", () => {
  it("sends the answer to the series, naming no date", async () => {
    renderOccurrence({
      viewerId: ALICE_ID,
      invitees: [
        {
          _id: "inv_1" as Id<"eventSeriesInvitees">,
          _creationTime: 0,
          seriesId: SERIES_ID,
          workspaceId: WORKSPACE_ID,
          userId: ALICE_ID,
          status: "pending",
        },
      ],
    });

    await userEvent.click(screen.getByRole("button", { name: "Going" }));

    // No `originalStartMs`: the Tuesday the invitee happened to be looking at
    // is not part of what they answered.
    expect(mutationCalls).toEqual([
      {
        name: "eventSeries:respond",
        args: { seriesId: SERIES_ID, status: "accepted" },
      },
    ]);
  });

  it("shows the same answer on a later occurrence of the same series", () => {
    renderOccurrence({
      viewerId: ALICE_ID,
      originalStartMs: SECOND_TUESDAY,
      invitees: [
        {
          _id: "inv_1" as Id<"eventSeriesInvitees">,
          _creationTime: 0,
          seriesId: SERIES_ID,
          workspaceId: WORKSPACE_ID,
          userId: ALICE_ID,
          status: "accepted",
        },
      ],
    });

    // The answer was given on some other Tuesday — there is only one, so it
    // is already the answer here, and on the Tuesdays the rule has not
    // produced yet. Nothing about this page's date reaches the roster row.
    expect(
      screen.getByRole("button", { name: "Going", pressed: true }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Decline", pressed: false }),
    ).toBeInTheDocument();
  });

  it("offers no answer to someone who is not on the roster", () => {
    renderOccurrence({ viewerId: "u_bystander" as Id<"users">, invitees: [] });

    expect(
      screen.queryByRole("button", { name: "Going" }),
    ).not.toBeInTheDocument();
  });
});
