import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { fakeDoc } from "@/test/collab-fakes";
import type { HydratedSurface, SurfaceMeta } from "./CollaborativeSurface";
import { SurfaceHeader } from "./SurfaceHeader";

/**
 * The member chrome, and the one rule it encodes: controls that would *change*
 * the resource are offered only while the server is answering. Tools that work
 * against the local copy are not gated, because they keep working without one.
 *
 * The header's own children are not under test — only whether this module
 * decides to render them.
 */

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
vi.mock("@/components/SyncIndicator", () => ({
  SyncIndicator: ({ state }: { state: string }) => (
    <div data-testid="status" data-state={state} />
  ),
}));

interface Meta extends SurfaceMeta {
  name: string;
  tags?: string[];
}

function surfaceOf(overrides: Partial<HydratedSurface<Meta>> = {}): HydratedSurface<Meta> {
  return {
    doc: fakeDoc({ isHydrated: true, isConnected: true }),
    meta: { name: "Quarterly plan" },
    isLive: true,
    sync: "connected",
    reportSyncDegraded: () => {},
    ...overrides,
  };
}

function renderHeader(surface: HydratedSurface<Meta>) {
  return render(
    <MemoryRouter>
      <SurfaceHeader<Meta>
        surface={surface}
        resourceType="doc"
        resourceId="doc-1"
        workspaceId={"ws-1" as never}
        onTagsChange={() => {}}
        settingsTitle="Document settings"
        tools={<div data-testid="tools" />}
        actions={(meta) => <div data-testid="actions">{meta.name}</div>}
        activeUsers={() => <div data-testid="active-users" />}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(cleanup);

describe("SurfaceHeader", () => {
  describe("while the server is not answering", () => {
    const offline = surfaceOf({
      doc: fakeDoc({ isHydrated: true, isOffline: true }),
      meta: { name: "written on a previous visit" },
      isLive: false,
      sync: "offline",
    });

    it("withholds every control that would change the resource", () => {
      renderHeader(offline);

      expect(screen.queryByTestId("favorite")).not.toBeInTheDocument();
      expect(screen.queryByTestId("tag-picker")).not.toBeInTheDocument();
      expect(screen.queryByTestId("backlinks")).not.toBeInTheDocument();
      expect(screen.queryByTestId("actions")).not.toBeInTheDocument();
      expect(screen.queryByTitle("Document settings")).not.toBeInTheDocument();
    });

    it("keeps the tools that work against the local copy", () => {
      renderHeader(offline);

      expect(screen.getByTestId("tools")).toBeInTheDocument();
    });

    it("still names what is on screen, from the copy this device kept", () => {
      renderHeader(offline);

      expect(screen.getByText("written on a previous visit")).toBeInTheDocument();
    });
  });

  describe("while it is", () => {
    it("offers them all", () => {
      renderHeader(surfaceOf());

      expect(screen.getByTestId("favorite")).toBeInTheDocument();
      expect(screen.getByTestId("tag-picker")).toBeInTheDocument();
      expect(screen.getByTestId("backlinks")).toBeInTheDocument();
      expect(screen.getByTestId("actions")).toBeInTheDocument();
      expect(screen.getByTitle("Document settings")).toBeInTheDocument();
    });

    it("shows presence only while the socket is actually up", () => {
      renderHeader(surfaceOf());
      expect(screen.getByTestId("active-users")).toBeInTheDocument();
      cleanup();

      renderHeader(
        surfaceOf({
          doc: fakeDoc({ isHydrated: true, isConnecting: true }),
          sync: "connecting",
        }),
      );
      expect(screen.queryByTestId("active-users")).not.toBeInTheDocument();
    });
  });

  it("passes the surface's verdict to the indicator rather than deriving its own", () => {
    renderHeader(surfaceOf({ sync: "error" }));

    expect(screen.getByTestId("status")).toHaveAttribute("data-state", "error");
  });
});
