import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { Awareness } from "y-protocols/awareness";
import type { ShareAccessLevel } from "@ripple/shared/shareTypes";
import { fakeDoc } from "@/test/collab-fakes";
import { GuestDiagramView } from "./GuestDiagramView";

/**
 * A guest's diagram canvas is mounted only against a hydrated replica — and,
 * once it is, gets the replica's awareness rather than the provider's.
 *
 * Those were two separate spellings of the same nullability: this view read
 * `provider?.awareness ?? null`, so the canvas was handed `null` presence for
 * as long as the socket was not up, while the member canvas took
 * `doc.awareness` — which is the provider's once connected and a local one
 * before that, and is never null.
 */

const ExcalidrawEditor = vi.hoisted(() =>
  vi.fn(
    (_props: {
      awareness: Awareness | null;
      provider: unknown;
      viewModeEnabled?: boolean;
    }) => <div data-testid="canvas" />,
  ),
);
vi.mock("@/pages/App/Diagram/ExcalidrawEditor", () => ({ ExcalidrawEditor }));

afterEach(() => {
  cleanup();
  ExcalidrawEditor.mockClear();
});

function renderGuest(
  doc: ReturnType<typeof fakeDoc>,
  accessLevel: ShareAccessLevel = "edit",
) {
  return render(
    <MemoryRouter>
      <GuestDiagramView doc={doc} accessLevel={accessLevel} />
    </MemoryRouter>,
  );
}

describe("GuestDiagramView", () => {
  it("mounts no canvas while the replica is unhydrated", () => {
    renderGuest(fakeDoc({ isConnecting: true, isHydrated: false }));

    expect(ExcalidrawEditor).not.toHaveBeenCalled();
    expect(screen.queryByTestId("canvas")).not.toBeInTheDocument();
  });

  it("mounts no canvas, and says so, when nothing can reach the room", async () => {
    renderGuest(fakeDoc({ isOffline: true, isHydrated: false }));

    await waitFor(() =>
      expect(screen.getByText(/isn't available offline/i)).toBeInTheDocument(),
    );
    expect(ExcalidrawEditor).not.toHaveBeenCalled();
  });

  it("mounts one once the sync completes", async () => {
    renderGuest(fakeDoc({ isConnected: true, isHydrated: true }));

    await waitFor(() => expect(screen.getByTestId("canvas")).toBeInTheDocument());
  });

  it("hands the canvas the replica's awareness, not the provider's", async () => {
    const doc = fakeDoc({ isConnected: true, isHydrated: true, provider: null });

    renderGuest(doc);

    await waitFor(() => expect(ExcalidrawEditor).toHaveBeenCalled());
    const props = ExcalidrawEditor.mock.calls.at(-1)![0];
    expect(props.awareness).toBe(doc.awareness);
    expect(props.provider).toBeNull();
  });

  it("keeps a view-only guest in view mode", async () => {
    renderGuest(fakeDoc({ isConnected: true, isHydrated: true }), "view");

    await waitFor(() => expect(ExcalidrawEditor).toHaveBeenCalled());
    expect(ExcalidrawEditor.mock.calls.at(-1)![0].viewModeEnabled).toBe(true);
  });
});
