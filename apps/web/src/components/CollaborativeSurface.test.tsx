import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { fakeDoc, fakeRoomStore } from "@/test/collab-fakes";
import type { CollaborativeDoc } from "@/hooks/use-collaborative-doc";
import {
  CollaborativeSurface,
  type HydratedSurface,
  type SurfaceMeta,
} from "./CollaborativeSurface";

/**
 * The opening sequence, which until recently existed only as early returns
 * inside seven page bodies that no test rendered.
 *
 * The load-bearing assertion in most of these is `body` never being called: a
 * body that is not mounted cannot author into a replica whose contents this
 * device does not know.
 *
 * There is nothing mocked here. The sequence takes the open room as a
 * parameter, so a test describes the replica it wants rather than driving a
 * fake socket until the real hook produces it — and because the sequence no
 * longer owns the member header, none of the header's children have to be
 * stubbed out to keep the assertions about this module's decisions.
 */

interface Meta extends SurfaceMeta {
  name: string;
  tags?: string[];
}

function renderSurface(
  doc: CollaborativeDoc,
  meta: Meta | null | undefined,
  body: (surface: HydratedSurface<Meta>) => React.ReactNode,
) {
  return render(
    <MemoryRouter>
      <CollaborativeSurface<Meta> resourceType="doc" doc={doc} meta={meta}>
        {body}
      </CollaborativeSurface>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("CollaborativeSurface", () => {
  it("reports a deleted resource even though this device has a copy of it", async () => {
    const body = vi.fn(() => <div data-testid="body" />);

    renderSurface(
      fakeDoc({ isHydrated: true, roomStore: fakeRoomStore({ meta: { name: "cached" } }) }),
      null,
      body,
    );

    await waitFor(() =>
      expect(screen.getByText(/has been deleted/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/this document has been deleted/i)).toBeInTheDocument();
    expect(body).not.toHaveBeenCalled();
  });

  it("says so, rather than showing a body, when nothing can reach the contents", async () => {
    const body = vi.fn(() => <div data-testid="body" />);

    renderSurface(fakeDoc({ isOffline: true, isHydrated: false }), undefined, body);

    await waitFor(() =>
      expect(screen.getByText(/isn't available offline/i)).toBeInTheDocument(),
    );
    expect(body).not.toHaveBeenCalled();
  });

  it("holds reserved space, and no body, while the room is still reachable", () => {
    const body = vi.fn(() => <div data-testid="body" />);

    const { container } = renderSurface(
      fakeDoc({ isConnecting: true, isHydrated: false }),
      undefined,
      body,
    );

    expect(container.querySelector(".flex-1")).toBeInTheDocument();
    expect(body).not.toHaveBeenCalled();
  });

  it("hands the body a hydrated replica once the room answers", async () => {
    const body = vi.fn((_surface: HydratedSurface<Meta>) => <div data-testid="body" />);

    renderSurface(
      fakeDoc({ isConnected: true, isHydrated: true }),
      { name: "Quarterly plan" },
      body,
    );

    await waitFor(() => expect(screen.getByTestId("body")).toBeInTheDocument());
    const surface = body.mock.calls.at(-1)![0];
    expect(surface.doc.isHydrated).toBe(true);
    expect(surface.meta?.name).toBe("Quarterly plan");
    expect(surface.isLive).toBe(true);
    expect(surface.sync).toBe("connected");
  });

  it("mounts the body from an offline cache without waiting for the server", async () => {
    const body = vi.fn((_surface: HydratedSurface<Meta>) => <div data-testid="body" />);

    renderSurface(
      fakeDoc({
        isOffline: true,
        isHydrated: true,
        isCacheLoaded: true,
        roomStore: fakeRoomStore({ meta: { name: "written on a previous visit" } }),
      }),
      undefined,
      body,
    );

    await waitFor(() => expect(screen.getByTestId("body")).toBeInTheDocument());
    await waitFor(() =>
      expect(body.mock.calls.at(-1)![0].meta?.name).toBe("written on a previous visit"),
    );
    // The copy this device kept, not the server's answer — so every control
    // that would change the resource stays withheld.
    expect(body.mock.calls.at(-1)![0].isLive).toBe(false);
    expect(body.mock.calls.at(-1)![0].sync).toBe("offline");
  });

  describe("a guest, who has no metadata query and no store", () => {
    const guest = (overrides: Partial<CollaborativeDoc> = {}) =>
      fakeDoc({ roomStore: null, ...overrides });

    it("is refused a body before the first sync, having nothing else to hydrate from", () => {
      const body = vi.fn(() => <div data-testid="body" />);

      renderSurface(guest({ isConnecting: true, isHydrated: false }), undefined, body);

      expect(body).not.toHaveBeenCalled();
    });

    it("gets a body once the sync completes", async () => {
      const body = vi.fn(() => <div data-testid="body" />);

      renderSurface(guest({ isConnected: true, isHydrated: true }), undefined, body);

      await waitFor(() => expect(screen.getByTestId("body")).toBeInTheDocument());
    });

    it("never reaches the deleted stage, because meta is undefined rather than null", async () => {
      const body = vi.fn(() => <div data-testid="body" />);

      renderSurface(guest({ isConnected: true, isHydrated: true }), undefined, body);

      await waitFor(() => expect(screen.getByTestId("body")).toBeInTheDocument());
      expect(screen.queryByText(/has been deleted/i)).not.toBeInTheDocument();
    });
  });

  describe("what it tells the user about the room", () => {
    it("calls an attempt in flight `connecting`, not offline", async () => {
      const body = vi.fn((_surface: HydratedSurface<Meta>) => <div data-testid="body" />);

      renderSurface(
        fakeDoc({ isConnecting: true, isHydrated: true, isCacheLoaded: true }),
        undefined,
        body,
      );

      await waitFor(() => expect(screen.getByTestId("body")).toBeInTheDocument());
      expect(body.mock.calls.at(-1)![0].sync).toBe("connecting");
    });

    it("lets a body report sync degraded, and outranks a live socket with it", async () => {
      const body = vi.fn((_surface: HydratedSurface<Meta>) => <div data-testid="body" />);

      renderSurface(fakeDoc({ isConnected: true, isHydrated: true }), undefined, body);

      await waitFor(() => expect(screen.getByTestId("body")).toBeInTheDocument());
      expect(body.mock.calls.at(-1)![0].sync).toBe("connected");

      body.mock.calls.at(-1)![0].reportSyncDegraded(true);

      // A live socket carrying nothing is the more misleading of the two.
      await waitFor(() => expect(body.mock.calls.at(-1)![0].sync).toBe("error"));
    });
  });
});
