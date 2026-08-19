import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { clearCollaborationTokenCache } from "@/lib/collaboration-token-cache";
import { contentUpdate, FakeProvider, resetCollabFakes, seedCache } from "@/test/collab-fakes";
import { CollaborativeSurface, type HydratedSurface, type SurfaceMeta } from "./CollaborativeSurface";

/**
 * The opening sequence, which until now existed only as early returns inside
 * seven page bodies that no test rendered.
 *
 * The load-bearing assertion in most of these is `body` never being called:
 * a body that is not mounted cannot author into a replica whose contents this
 * device does not know.
 */

vi.mock("y-partyserver/provider", async () => ({
  default: (await import("@/test/collab-fakes")).FakeProvider,
}));
vi.mock("y-indexeddb", async () => ({
  IndexeddbPersistence: (await import("@/test/collab-fakes")).FakeIndexeddbPersistence,
}));
vi.mock("convex/react", async () => {
  const { convexQuery: query, mint } = await import("@/test/collab-fakes");
  return {
    useConvex: () => ({ query }),
    useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
    useAction: () => () => mint.run(),
  };
});

// The header's own children are not under test here — only whether this module
// decides to render them. Stubs keep the assertions about that decision.
vi.mock("@/components/FavoriteButton", () => ({
  FavoriteButton: () => <div data-testid="favorite" />,
}));
vi.mock("@/components/TagPickerButton", () => ({
  TagPickerButton: () => <div data-testid="tag-picker" />,
  TagInlineStrip: () => <div data-testid="tag-strip" />,
}));
vi.mock("@/components/BacklinksDrawer", () => ({
  BacklinksButton: () => <div data-testid="backlinks" />,
}));
vi.mock("@/pages/ResourceDeleted", () => ({
  ResourceDeleted: ({ resourceType }: { resourceType: string }) => (
    <div data-testid="deleted">{resourceType}</div>
  ),
}));
vi.mock("@/pages/App/Document/ConnectionStatus", () => ({
  ConnectionStatus: ({ isConnected, isConnecting }: Record<string, boolean | undefined>) => (
    <div
      data-testid="status"
      data-connected={String(!!isConnected)}
      data-connecting={String(!!isConnecting)}
    />
  ),
}));

const ROOM = "doc-doc-1";

interface Meta extends SurfaceMeta {
  name: string;
  tags?: string[];
}

function renderSurface(
  meta: Meta | null | undefined,
  body: (surface: HydratedSurface<Meta>) => React.ReactNode,
) {
  return render(
    <MemoryRouter>
      <CollaborativeSurface<Meta>
        resourceType="doc"
        resourceId="doc-1"
        workspaceId={"ws-1" as never}
        meta={meta}
        onTagsChange={() => {}}
        settingsTitle="Document settings"
      >
        {body}
      </CollaborativeSurface>
    </MemoryRouter>,
  );
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    value: online,
    configurable: true,
  });
}

beforeEach(() => {
  resetCollabFakes();
  clearCollaborationTokenCache();
  setOnline(true);
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

// Auto-cleanup only registers under vitest `globals`, which this project does
// not enable — without this, one test's DOM is still mounted during the next.
afterEach(cleanup);

describe("CollaborativeSurface", () => {
  it("reports a deleted resource even though this device has a copy of it", async () => {
    seedCache(ROOM, contentUpdate("still cached here"));
    const body = vi.fn(() => <div data-testid="body" />);

    renderSurface(null, body);

    await waitFor(() => expect(screen.getByTestId("deleted")).toBeInTheDocument());
    expect(screen.getByTestId("deleted")).toHaveTextContent("document");
    expect(body).not.toHaveBeenCalled();
  });

  it("says so, rather than showing a body, when nothing can reach the contents", async () => {
    setOnline(false);
    const body = vi.fn(() => <div data-testid="body" />);

    renderSurface(undefined, body);

    await waitFor(() =>
      expect(screen.getByText(/isn't available offline/i)).toBeInTheDocument(),
    );
    expect(body).not.toHaveBeenCalled();
  });

  it("holds reserved space, and no body, while the room is still reachable", async () => {
    const body = vi.fn(() => <div data-testid="body" />);

    const { container } = renderSurface(undefined, body);

    await waitFor(() => expect(FakeProvider.instances).toHaveLength(1));
    expect(container.querySelector(".flex-1")).toBeInTheDocument();
    expect(screen.queryByTestId("status")).not.toBeInTheDocument();
    expect(body).not.toHaveBeenCalled();
  });

  it("hands the body a hydrated replica once the room answers", async () => {
    const body = vi.fn((_surface: HydratedSurface<Meta>) => <div data-testid="body" />);

    renderSurface({ name: "Quarterly plan" }, body);

    await waitFor(() => expect(FakeProvider.instances).toHaveLength(1));
    act(() => FakeProvider.instances[0].connectAndSync());

    await waitFor(() => expect(screen.getByTestId("body")).toBeInTheDocument());
    const surface = body.mock.calls.at(-1)![0];
    expect(surface.doc.isHydrated).toBe(true);
    expect(surface.meta?.name).toBe("Quarterly plan");
    expect(surface.isLive).toBe(true);
  });

  it("mounts the body from an offline cache without waiting for the server", async () => {
    setOnline(false);
    seedCache(ROOM, contentUpdate("written on a previous visit"));
    const body = vi.fn((_surface: HydratedSurface<Meta>) => <div data-testid="body" />);

    renderSurface(undefined, body);

    await waitFor(() => expect(screen.getByTestId("body")).toBeInTheDocument());
    const surface = body.mock.calls.at(-1)![0];
    expect(surface.isLive).toBe(false);
  });

  describe("what the header offers while the server is not answering", () => {
    it("withholds every control that would change the resource", async () => {
      setOnline(false);
      seedCache(ROOM, contentUpdate("written on a previous visit"));

      renderSurface(undefined, () => <div data-testid="body" />);

      await waitFor(() => expect(screen.getByTestId("body")).toBeInTheDocument());
      expect(screen.queryByTestId("favorite")).not.toBeInTheDocument();
      expect(screen.queryByTestId("tag-picker")).not.toBeInTheDocument();
      expect(screen.queryByTestId("backlinks")).not.toBeInTheDocument();
      expect(screen.queryByTitle("Document settings")).not.toBeInTheDocument();
    });

    it("offers them all once it is", async () => {
      renderSurface({ name: "Quarterly plan" }, () => <div data-testid="body" />);

      await waitFor(() => expect(FakeProvider.instances).toHaveLength(1));
      act(() => FakeProvider.instances[0].connectAndSync());

      await waitFor(() => expect(screen.getByTestId("favorite")).toBeInTheDocument());
      expect(screen.getByTestId("tag-picker")).toBeInTheDocument();
      expect(screen.getByTestId("backlinks")).toBeInTheDocument();
      expect(screen.getByTitle("Document settings")).toBeInTheDocument();
    });
  });

  it("tells the indicator an attempt is in flight, rather than calling it offline", async () => {
    seedCache(ROOM, contentUpdate("written on a previous visit"));

    renderSurface(undefined, () => <div data-testid="body" />);

    await waitFor(() => expect(screen.getByTestId("status")).toBeInTheDocument());
    const status = screen.getByTestId("status");
    expect(status).toHaveAttribute("data-connected", "false");
    expect(status).toHaveAttribute("data-connecting", "true");
  });
});
