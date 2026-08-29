import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  CommentPendingWatcher,
  CommentsToggleButton,
  CommentsUIProvider,
} from "./CommentsRail";

/**
 * The two-way link between an armed ("pending") comment in the document and the
 * comments rail being open. The rail body itself needs BlockNote context, so
 * what is exercised here is the pair that carries the state: the header toggle
 * and the watcher, over a stand-in comments extension.
 */

/** Minimal stand-in for BlockNote's comments extension: just the pending flag. */
function fakeCommentsEditor() {
  const listeners = new Set<() => void>();
  const state = { pendingComment: false };
  const emit = () => listeners.forEach((listener) => listener());
  const ext = {
    startPendingComment: () => {
      state.pendingComment = true;
      emit();
    },
    stopPendingComment: vi.fn(() => {
      state.pendingComment = false;
      emit();
    }),
    store: {
      state,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
  const editor = { getExtension: () => ext };
  return { editor: editor as never, ext };
}

function renderWatcher() {
  const { editor, ext } = fakeCommentsEditor();
  render(
    <CommentsUIProvider>
      <CommentsToggleButton />
      <CommentPendingWatcher editor={editor} />
    </CommentsUIProvider>,
  );
  const toggle = () => screen.getByRole("button");
  const isOpen = () => toggle().getAttribute("aria-pressed") === "true";
  return { ext, toggle, isOpen };
}

afterEach(cleanup);

describe("CommentPendingWatcher", () => {
  it("opens the rail when a comment is armed from the document", () => {
    const { ext, isOpen } = renderWatcher();
    expect(isOpen()).toBe(false);
    act(() => ext.startPendingComment());
    expect(isOpen()).toBe(true);
  });

  it("closes on the toggle while a comment is still armed", async () => {
    const user = userEvent.setup();
    const { ext, toggle, isOpen } = renderWatcher();
    act(() => ext.startPendingComment());

    await user.click(toggle());

    // Closing disarms the comment, so nothing re-opens the rail — before, the
    // arm survived and the watcher put the rail straight back.
    expect(ext.stopPendingComment).toHaveBeenCalled();
    expect(isOpen()).toBe(false);
  });

  it("reopens on a later arm after being closed", async () => {
    const user = userEvent.setup();
    const { ext, toggle, isOpen } = renderWatcher();
    act(() => ext.startPendingComment());
    await user.click(toggle());

    act(() => ext.startPendingComment());
    expect(isOpen()).toBe(true);
  });

  it("leaves an unarmed close alone", async () => {
    const user = userEvent.setup();
    const { ext, toggle, isOpen } = renderWatcher();
    await user.click(toggle());
    expect(isOpen()).toBe(true);

    await user.click(toggle());
    expect(isOpen()).toBe(false);
    expect(ext.stopPendingComment).not.toHaveBeenCalled();
  });
});
