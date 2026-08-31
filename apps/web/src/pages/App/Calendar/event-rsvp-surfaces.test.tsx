/**
 * The RSVP control on the two surfaces that render an event row — the page
 * and the sheet the dashboard calendar opens — for the two kinds of row that
 * reach them: a plain one-off event, and an **override**, the
 * `calendarEvents` row a moved or edited occurrence of a series wears.
 *
 * They answer different questions. A one-off has a roster of its own and its
 * own `calendarEvents.respond`. An override has no roster at all: the invitee
 * rows belong to the series (`calendarEvents.cancel` says so at its own site),
 * so an override that asked its own row who was coming would find nobody, and
 * an answer given here has to be the series' one answer or the moved Tuesday
 * would be the one occurrence nobody had answered for.
 */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Object.defineProperty(Element.prototype, "scrollIntoView", {
  value: () => {},
  writable: true,
  configurable: true,
});

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

import type { Id } from "@convex/_generated/dataModel";
import { EventDetailPage } from "./EventDetailPage";
import { EventDetailSheet } from "./EventDetailSheet";

const WORKSPACE_ID = "ws_1" as Id<"workspaces">;
const EVENT_ID = "evt_1" as Id<"calendarEvents">;
const SERIES_ID = "ser_1" as Id<"eventSeries">;
const ORGANIZER_ID = "u_org" as Id<"users">;
const ALICE_ID = "u_alice" as Id<"users">;

const TUESDAY = Date.UTC(2026, 8, 1, 7, 0);

/** What the server would answer, for the row this test is about. */
function seed(
  over: {
    /** Set together, and only on an override. */
    seriesId?: Id<"eventSeries">;
    originalStartMs?: number;
    /** The event row's own roster — empty on an override, by design. */
    invitees?: unknown[];
    /** The series' roster, read only when this row is an override. */
    seriesInvitees?: unknown[];
  } = {},
) {
  queryAnswers.clear();
  mutationCalls.length = 0;
  queryAnswers.set("calendarEvents:get", {
    event: {
      _id: EVENT_ID,
      workspaceId: WORKSPACE_ID,
      title: "Standup",
      startsAt: TUESDAY,
      endsAt: TUESDAY + 30 * 60 * 1000,
      timezone: "Europe/Rome",
      createdBy: ORGANIZER_ID,
      seriesId: over.seriesId,
      originalStartMs: over.originalStartMs,
    },
    invitees: over.invitees ?? [],
    organizer: { userId: ORGANIZER_ID, name: "Olive" },
    channelName: undefined,
  });
  queryAnswers.set("users:viewer", { _id: ALICE_ID });
  queryAnswers.set("channels:listHostable", []);
  queryAnswers.set("workspaceMembers:membersWithRoles", []);
  queryAnswers.set("tags:listWorkspaceTags", []);
  // `null` is the server saying "not a series", which is what a bare link to
  // an event row resolves to.
  queryAnswers.set("eventSeries:resolveLink", null);
  queryAnswers.set("eventSeries:listInvitees", over.seriesInvitees ?? []);
}

function renderEventPage(over: Parameters<typeof seed>[0] = {}) {
  seed(over);
  return render(
    <MemoryRouter
      initialEntries={[`/workspaces/${WORKSPACE_ID}/events/${EVENT_ID}`]}
    >
      <Routes>
        <Route
          path="/workspaces/:workspaceId/events/:eventId"
          element={<EventDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

const seriesRow = (status: string) => ({
  _id: "inv_1" as Id<"eventSeriesInvitees">,
  _creationTime: 0,
  seriesId: SERIES_ID,
  workspaceId: WORKSPACE_ID,
  userId: ALICE_ID,
  status,
});

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(cleanup);

describe("a moved occurrence of a series", () => {
  it("shows the answer given for the series, not an unanswered invitation", () => {
    renderEventPage({
      seriesId: SERIES_ID,
      originalStartMs: TUESDAY,
      seriesInvitees: [seriesRow("accepted")],
    });

    // The override's own roster is empty and always will be. What the invitee
    // sees here is the one answer they gave, same as on every other Tuesday.
    expect(
      screen.getByRole("button", { name: "Going", pressed: true }),
    ).toBeInTheDocument();
  });

  it("sends a changed answer to the series", async () => {
    renderEventPage({
      seriesId: SERIES_ID,
      originalStartMs: TUESDAY,
      seriesInvitees: [seriesRow("accepted")],
    });

    await userEvent.click(screen.getByRole("button", { name: "Decline" }));

    // `eventSeries.respond` with a `seriesId`, never `calendarEvents.respond`
    // with this row's id: there is no invitee row on the override for the
    // latter to find, and answering one Tuesday is not a thing this product
    // offers (spec 0003, "Out of Scope").
    expect(mutationCalls).toEqual([
      {
        name: "eventSeries:respond",
        args: { seriesId: SERIES_ID, status: "declined" },
      },
    ]);
  });
});

describe("a one-off event", () => {
  it("still answers its own invitation", async () => {
    renderEventPage({
      invitees: [
        {
          _id: "inv_1" as Id<"calendarEventInvitees">,
          userId: ALICE_ID,
          status: "pending",
        },
      ],
    });

    await userEvent.click(screen.getByRole("button", { name: "Going" }));

    expect(mutationCalls).toEqual([
      {
        name: "calendarEvents:respond",
        args: { eventId: EVENT_ID, status: "accepted" },
      },
    ]);
  });
});

describe("the sheet the dashboard calendar opens", () => {
  it("answers the series when the row it holds is an override", async () => {
    // Clicking a moved occurrence on the calendar opens the sheet, not the
    // page — it is a `calendarEvents` row and the calendar links to it as
    // one. Answering has to mean the same thing in both.
    seed({
      seriesId: SERIES_ID,
      originalStartMs: TUESDAY,
      seriesInvitees: [seriesRow("pending")],
    });
    render(
      <MemoryRouter>
        <EventDetailSheet
          eventId={EVENT_ID}
          open
          onOpenChange={() => {}}
          workspaceId={WORKSPACE_ID}
        />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Maybe" }));

    expect(mutationCalls).toEqual([
      {
        name: "eventSeries:respond",
        args: { seriesId: SERIES_ID, status: "tentative" },
      },
    ]);
  });
});
