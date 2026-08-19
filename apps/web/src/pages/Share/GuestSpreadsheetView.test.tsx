import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ShareAccessLevel } from "@ripple/shared/shareTypes";
import { fakeDoc } from "@/test/collab-fakes";
import { GuestSpreadsheetView } from "./GuestSpreadsheetView";

/**
 * The bug this candidate started from, as a test.
 *
 * `SpreadsheetYjsBinding` seeded the grid's empty root from its constructor, so
 * constructing it against an unhydrated replica planted a grid beside the real
 * one. A guest's replica is unhydrated for the whole window between mount and
 * first sync — they have no cache and no cold-start snapshot — and this view
 * constructed the binding immediately, because hooks cannot sit after the early
 * return that was the only gate here.
 *
 * `useJSpreadsheetInstance` is the module that builds the binding, so "was it
 * called" is exactly "was a binding constructed". What happens to the data if
 * one *is* built against an unhydrated replica is `collab/empty-grid.test.ts`.
 */

const useJSpreadsheetInstance = vi.hoisted(() =>
  vi.fn((_options: { isHydrated: boolean; editable?: boolean }) => ({})),
);
vi.mock("@/hooks/use-jspreadsheet-instance", () => ({ useJSpreadsheetInstance }));

afterEach(() => {
  cleanup();
  useJSpreadsheetInstance.mockClear();
});

function renderGuest(
  doc: ReturnType<typeof fakeDoc>,
  accessLevel: ShareAccessLevel = "edit",
) {
  return render(
    <MemoryRouter>
      <GuestSpreadsheetView doc={doc} accessLevel={accessLevel} />
    </MemoryRouter>,
  );
}

describe("GuestSpreadsheetView", () => {
  it("builds no binding while the replica is unhydrated", () => {
    renderGuest(fakeDoc({ isConnecting: true, isHydrated: false }));

    expect(useJSpreadsheetInstance).not.toHaveBeenCalled();
  });

  it("builds no binding, and says so, when nothing can reach the room", async () => {
    renderGuest(fakeDoc({ isOffline: true, isHydrated: false }));

    await waitFor(() =>
      expect(screen.getByText(/isn't available offline/i)).toBeInTheDocument(),
    );
    expect(useJSpreadsheetInstance).not.toHaveBeenCalled();
  });

  it("builds one once the sync completes, and tells it the replica is hydrated", async () => {
    renderGuest(fakeDoc({ isConnected: true, isHydrated: true }));

    await waitFor(() => expect(useJSpreadsheetInstance).toHaveBeenCalled());
    const options = useJSpreadsheetInstance.mock.calls.at(-1)![0];
    expect(options.isHydrated).toBe(true);
    expect(options.editable).toBe(true);
  });

  it("keeps a view-only guest read-only", async () => {
    renderGuest(fakeDoc({ isConnected: true, isHydrated: true }), "view");

    await waitFor(() => expect(useJSpreadsheetInstance).toHaveBeenCalled());
    expect(useJSpreadsheetInstance.mock.calls.at(-1)![0].editable).toBe(false);
  });
});
