import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ShareAccessLevel } from "@ripple/shared/shareTypes";
import { fakeDoc } from "@/test/collab-fakes";
import { GuestDocumentView } from "./GuestDocumentView";

/**
 * A guest's editor is created only against a hydrated replica.
 *
 * `editable={accessLevel === "edit" && isHydrated}` used to be the whole of the
 * protection here, and it is the weaker half: a read-only editor still binds to
 * the fragment, and binding is what y-prosemirror creates the rival root from.
 * Not creating the editor at all is the difference.
 */

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
// The document schema drags in the Excalidraw block, and with it a JSON import
// vite-node will not load. Nothing here is about the schema's contents.
vi.mock("@/pages/App/Document/schema", () => ({ documentSchema: {} }));

const useCreateBlockNote = vi.hoisted(() =>
  vi.fn((_options: unknown, _deps?: unknown[]) => ({ mock: "editor" })),
);
const BlockNoteView = vi.hoisted(() =>
  vi.fn((_props: { editable: boolean }) => <div data-testid="editor" />),
);
vi.mock("@blocknote/react", () => ({ useCreateBlockNote }));
vi.mock("@blocknote/shadcn", () => ({ BlockNoteView }));

afterEach(() => {
  cleanup();
  useCreateBlockNote.mockClear();
  BlockNoteView.mockClear();
});

function renderGuest(
  doc: ReturnType<typeof fakeDoc>,
  accessLevel: ShareAccessLevel = "edit",
) {
  return render(
    <MemoryRouter>
      <GuestDocumentView
        doc={doc}
        accessLevel={accessLevel}
        guestName="Sam"
        guestColor="#123456"
      />
    </MemoryRouter>,
  );
}

describe("GuestDocumentView", () => {
  it("creates no editor while the replica is unhydrated", () => {
    renderGuest(fakeDoc({ isConnecting: true, isHydrated: false }));

    expect(useCreateBlockNote).not.toHaveBeenCalled();
    expect(screen.queryByTestId("editor")).not.toBeInTheDocument();
  });

  it("creates no editor, and says so, when nothing can reach the room", async () => {
    renderGuest(fakeDoc({ isOffline: true, isHydrated: false }));

    await waitFor(() =>
      expect(screen.getByText(/isn't available offline/i)).toBeInTheDocument(),
    );
    expect(useCreateBlockNote).not.toHaveBeenCalled();
  });

  it("creates one once the sync completes, bound to the guest's identity", async () => {
    renderGuest(fakeDoc({ isConnected: true, isHydrated: true }));

    await waitFor(() => expect(screen.getByTestId("editor")).toBeInTheDocument());
    expect(useCreateBlockNote).toHaveBeenCalled();
    expect(BlockNoteView.mock.calls.at(-1)![0].editable).toBe(true);
  });

  it("keeps a view-only guest read-only", async () => {
    renderGuest(fakeDoc({ isConnected: true, isHydrated: true }), "view");

    await waitFor(() => expect(screen.getByTestId("editor")).toBeInTheDocument());
    expect(BlockNoteView.mock.calls.at(-1)![0].editable).toBe(false);
  });
});
