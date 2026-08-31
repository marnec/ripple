/**
 * Inviting people from the create form.
 *
 * The form used to take the invitee picker away the moment a repeat was
 * chosen, because a series had no roster to give the names to. It has one now,
 * so what these tests pin is that the picker is the *same* picker either way
 * and that the names reach the mutation that was actually called — the
 * observable an organizer cares about being "the people I picked were
 * invited", not which component rendered.
 */

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  getFunctionName,
  type FunctionReference,
} from "convex/server";
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
// The custom-rule dialog is a `ResponsiveDialog`, which asks the viewport
// whether it is a phone. jsdom ships no `matchMedia`; the reference below is
// only tested for presence, never detached and called, so there is no `this`
// to lose.
// eslint-disable-next-line @typescript-eslint/unbound-method
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia;

const { queryAnswers, mutationCalls } = vi.hoisted(() => ({
  queryAnswers: new Map<string, unknown>(),
  mutationCalls: [] as { name: string; args: unknown }[],
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
      return Promise.resolve("ser_new");
    };
  },
}));
vi.mock("sonner", () => ({
  toast: { success: () => {}, error: () => {} },
}));

import type { Id } from "@convex/_generated/dataModel";
import { CreateEventForm } from "./CreateEventForm";

const WORKSPACE_ID = "ws_1" as Id<"workspaces">;
const BOB = "u_bob" as Id<"users">;

/** A Tuesday, so "Weekly on Tuesday" is the preset the select offers. */
const START = new Date(2026, 8, 1, 9, 0, 0, 0);
const END = new Date(2026, 8, 1, 9, 30, 0, 0);

function renderForm() {
  queryAnswers.clear();
  mutationCalls.length = 0;
  queryAnswers.set("channels:listHostable", []);
  queryAnswers.set("workspaceMembers:membersWithRoles", [
    { userId: BOB, name: "Bob", email: "bob@example.com" },
  ]);

  return render(
    <CreateEventForm
      workspaceId={WORKSPACE_ID}
      initialDate={START}
      initialEndDate={END}
      onSuccess={() => {}}
      onCancel={() => {}}
    />,
  );
}

/** Move the Repeat select onto its weekly preset. */
async function chooseWeeklyRepeat() {
  // The trigger carries no accessible name of its own, so it is reached
  // through the field its label sits in.
  const field = screen.getByText("Repeat").parentElement!;
  await userEvent.click(within(field).getByRole("combobox"));
  await userEvent.click(
    await screen.findByRole("option", { name: "Weekly on Tuesday" }),
  );
}

/** Put one colleague and one outsider on the roster. */
async function pickBobAndAGuest() {
  await userEvent.click(
    screen.getByRole("button", { name: "Add workspace members" }),
  );
  await userEvent.click(await screen.findByText("Bob"));
  await userEvent.type(
    screen.getByPlaceholderText("Add guest by email"),
    "zoe@elsewhere.test",
  );
  await userEvent.click(screen.getByRole("button", { name: "Add guest email" }));
}

afterEach(cleanup);

describe("the invitee picker on the create form", () => {
  it("is still offered once a repeat is chosen", async () => {
    renderForm();

    expect(
      screen.getByRole("button", { name: "Add workspace members" }),
    ).toBeInTheDocument();

    await chooseWeeklyRepeat();

    // The same picker, not a sentence explaining why there isn't one.
    expect(
      screen.getByRole("button", { name: "Add workspace members" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/can't be shared with anyone yet/i),
    ).not.toBeInTheDocument();
  });

  it("carries the chosen roster into the series it creates", async () => {
    renderForm();

    await userEvent.type(screen.getByPlaceholderText("Weekly sync"), "Standup");
    await chooseWeeklyRepeat();
    await pickBobAndAGuest();
    await userEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(mutationCalls).toHaveLength(1));
    const [call] = mutationCalls;
    expect(call.name).toBe("eventSeries:create");
    expect(call.args).toMatchObject({
      title: "Standup",
      invitees: { userIds: [BOB], guestEmails: ["zoe@elsewhere.test"] },
    });
  });

  it("still writes a one-off exactly as it always did", async () => {
    renderForm();

    await userEvent.type(screen.getByPlaceholderText("Weekly sync"), "Coffee");
    await pickBobAndAGuest();
    await userEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(mutationCalls).toHaveLength(1));
    const [call] = mutationCalls;
    // "Does not repeat" is still a different resource written by a different
    // mutation — the roster reaching series creation must not have quietly
    // turned every event into one.
    expect(call.name).toBe("calendarEvents:create");
    expect(call.args).toEqual({
      workspaceId: WORKSPACE_ID,
      title: "Coffee",
      description: undefined,
      startsAt: START.getTime(),
      endsAt: END.getTime(),
      timezone: expect.any(String),
      channelId: undefined,
      invitees: { userIds: [BOB], guestEmails: ["zoe@elsewhere.test"] },
    });
  });
});
