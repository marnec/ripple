import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { MessageWithAuthor } from "@convex/types/channel";
import { MessageList } from "./MessageList";

/**
 * jsdom has no layout: scrollHeight/clientHeight are always 0 and scrollTop is
 * inert. These helpers give the viewport a fake geometry we can drive, which is
 * what the scroll logic actually reads.
 */
function stubViewportGeometry(viewport: HTMLElement, clientHeight: number, scrollHeight: number) {
  let currentScrollTop = 0;
  let currentScrollHeight = scrollHeight;
  Object.defineProperty(viewport, "clientHeight", { configurable: true, get: () => clientHeight });
  Object.defineProperty(viewport, "scrollHeight", {
    configurable: true,
    get: () => currentScrollHeight,
  });
  Object.defineProperty(viewport, "scrollTop", {
    configurable: true,
    get: () => currentScrollTop,
    set: (value: number) => {
      currentScrollTop = value;
    },
  });
  viewport.scrollTo = ((options: ScrollToOptions) => {
    currentScrollTop = options.top ?? currentScrollTop;
  }) as HTMLElement["scrollTo"];
  return {
    grow: (to: number) => {
      currentScrollHeight = to;
    },
    scrollTo: (top: number) => {
      currentScrollTop = top;
      act(() => {
        viewport.dispatchEvent(new Event("scroll"));
      });
    },
  };
}

interface FakeObserver {
  callback: ResizeObserverCallback;
  targets: Set<Element>;
}

let observers: FakeObserver[] = [];

beforeEach(() => {
  observers = [];
  vi.stubGlobal(
    "ResizeObserver",
    class implements FakeObserver {
      callback: ResizeObserverCallback;
      targets = new Set<Element>();
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        observers.push(this);
      }
      observe(target: Element) {
        this.targets.add(target);
      }
      unobserve(target: Element) {
        this.targets.delete(target);
      }
      disconnect() {
        this.targets.clear();
      }
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * Notify each observer that its observed elements resized, as the browser would
 * after images decode. Observers that never called `observe` stay silent — the
 * browser wouldn't call them either.
 */
function flushResize() {
  act(() => {
    for (const observer of observers) {
      if (observer.targets.size === 0) continue;
      const entries = [...observer.targets].map((target) => ({ target }) as ResizeObserverEntry);
      observer.callback(entries, observer as unknown as ResizeObserver);
    }
  });
}

const messages = [{ isomorphicId: "b" }, { isomorphicId: "a" }] as MessageWithAuthor[];

function renderList() {
  const view = render(
    <MessageList messages={messages} onLoadMore={() => {}} isLoading={false} messagesReady>
      <li>a</li>
      <li>b</li>
    </MessageList>,
  );
  const viewport = view.container.querySelector<HTMLElement>(
    '[data-slot="scroll-area-viewport"]',
  )!;
  return { view, viewport };
}

const scrollButton = () => screen.queryByRole("button", { name: "Scroll to latest messages" });

describe("MessageList late content growth", () => {
  it("re-pins to the bottom when the list grows after the initial scroll", () => {
    const { viewport } = renderList();
    const geometry = stubViewportGeometry(viewport, 500, 500);

    // Images finish decoding: the list is now taller than the viewport. The
    // browser fires no scroll event for this, so only the resize path can
    // notice — without it the view is stranded at the old scrollTop.
    geometry.grow(1500);
    flushResize();

    expect(viewport.scrollTop).toBe(1000);
    expect(scrollButton()).toBeNull();
  });

  it("leaves a user who scrolled up alone, and keeps the button visible", () => {
    const { viewport } = renderList();
    const geometry = stubViewportGeometry(viewport, 500, 1500);

    geometry.scrollTo(200);
    expect(scrollButton()).not.toBeNull();

    geometry.grow(2500);
    flushResize();

    expect(viewport.scrollTop).toBe(200);
    expect(scrollButton()).not.toBeNull();
  });
});
