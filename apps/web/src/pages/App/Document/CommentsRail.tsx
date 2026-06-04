import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { BlockNoteEditor } from "@blocknote/core";
import type { ThreadData } from "@blocknote/core/comments";
import {
  Thread,
  getReferenceText,
  useEditorDOMElement,
  useThreads,
} from "@blocknote/react";
import { Check, MessageSquare, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  countOpenThreads,
  visibleThreads,
  type CommentFilter,
  type CommentSort,
  type ThreadPositions,
} from "./comment-rail-utils";

type AnyEditor = BlockNoteEditor<any, any, any>;

/** The slice of the comments extension instance the rail interacts with. */
type CommentsExtensionInstance = {
  selectThread: (threadId: string | undefined, scrollToThread?: boolean) => void;
  threadStore: {
    resolveThread: (options: { threadId: string }) => Promise<void>;
    unresolveThread: (options: { threadId: string }) => Promise<void>;
    auth: {
      canResolveThread: (thread: ThreadData) => boolean;
      canUnresolveThread: (thread: ThreadData) => boolean;
    };
  };
  store: {
    state: {
      selectedThreadId: string | undefined;
      threadPositions: ThreadPositions;
      pendingComment: boolean;
    };
    subscribe: (listener: () => void) => () => void;
  };
};

function getCommentsExtension(
  editor: AnyEditor,
): CommentsExtensionInstance | undefined {
  try {
    return editor.getExtension("comments") as
      | CommentsExtensionInstance
      | undefined;
  } catch {
    return undefined;
  }
}

const EMPTY_POSITIONS: ThreadPositions = new Map();

/**
 * Subscribe to a slice of the comments extension's tanstack store. Returns the
 * selected thread id and the live map of thread anchor positions (used for
 * position-sorting and as a presence check that an anchor still resolves).
 *
 * Each value is read in its own `useSyncExternalStore` so getSnapshot returns a
 * stable reference (a primitive or the store's own Map) — returning a fresh
 * wrapper object each call would trip React's "getSnapshot should be cached"
 * infinite-render guard.
 */
function useCommentsStore(editor: AnyEditor): {
  selectedThreadId: string | undefined;
  positions: ThreadPositions;
} {
  const ext = getCommentsExtension(editor);
  const subscribe = (onChange: () => void) =>
    ext ? ext.store.subscribe(onChange) : () => {};
  const selectedThreadId = useSyncExternalStore(
    subscribe,
    () => ext?.store.state.selectedThreadId,
  );
  const positions = useSyncExternalStore(
    subscribe,
    () => ext?.store.state.threadPositions ?? EMPTY_POSITIONS,
  );
  return { selectedThreadId, positions };
}

// --- Shared UI state (open + open-count) -----------------------------------
// The toggle button lives in the header (outside BlockNoteView) while the live
// thread count comes from `useThreads` (inside BlockNoteView). A context bridges
// the two without prop-drilling through the editor tree.

type CommentsUIValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  count: number;
  setCount: (count: number) => void;
};

const CommentsUIContext = createContext<CommentsUIValue | null>(null);

export function CommentsUIProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  return (
    <CommentsUIContext.Provider value={{ open, setOpen, count, setCount }}>
      {children}
    </CommentsUIContext.Provider>
  );
}

function useCommentsUI(): CommentsUIValue {
  const ctx = useContext(CommentsUIContext);
  if (!ctx) {
    throw new Error("useCommentsUI must be used within a CommentsUIProvider");
  }
  return ctx;
}

/**
 * Always-mounted (renders nothing) reporter that keeps the toggle badge's open
 * count in sync. Must live inside `BlockNoteView` so `useThreads` has context.
 */
export function CommentCountReporter() {
  const threads = useThreads();
  const { setCount } = useCommentsUI();
  const open = countOpenThreads([...threads.values()]);
  useEffect(() => {
    setCount(open);
  }, [open, setCount]);
  return null;
}

/**
 * Header toggle that opens/closes the rail. Icon-only; the open-thread count
 * rides as a superscript badge anchored to the top-right corner. The badge is
 * absolutely positioned, so it never shifts the surrounding header layout when
 * it appears or disappears.
 */
export function CommentsToggleButton() {
  const { open, setOpen, count } = useCommentsUI();
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-pressed={open}
      aria-label={
        count > 0 ? `${open ? "Hide" : "Show"} comments (${count})` : "Comments"
      }
      className={cn(
        "relative inline-flex items-center justify-center rounded-md p-1.5 transition-colors",
        open
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
      title={open ? "Hide comments" : "Show comments"}
    >
      <MessageSquare className="size-4" />
      {count > 0 && (
        <span className="absolute -top-1 -right-1 min-w-3.5 rounded-full bg-primary px-1 text-[10px] leading-[1.1] font-mono tabular-nums text-primary-foreground">
          {count}
        </span>
      )}
    </button>
  );
}

// --- Rail content -----------------------------------------------------------

const FILTERS: { value: CommentFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

/** Briefly pulse the anchored text in the document after a jump from the rail. */
function flashAnchor(root: HTMLElement | undefined, threadId: string) {
  if (!root) return;
  const marks = root.querySelectorAll<HTMLElement>(
    `[data-bn-thread-id="${CSS.escape(threadId)}"]`,
  );
  marks.forEach((mark) => {
    mark.classList.remove("bn-comment-flash");
    // Force reflow so re-adding the class restarts the animation.
    void mark.offsetWidth;
    mark.classList.add("bn-comment-flash");
    const clear = () => mark.classList.remove("bn-comment-flash");
    mark.addEventListener("animationend", clear, { once: true });
  });
}

/**
 * The body of the rail: filter segmented control + the scrollable thread list.
 * Reused by both the desktop docked panel and the mobile drawer.
 */
function CommentsRailContent({
  editor,
  onClose,
  showClose,
}: {
  editor: AnyEditor;
  onClose: () => void;
  showClose: boolean;
}) {
  const threadMap = useThreads();
  const { selectedThreadId, positions } = useCommentsStore(editor);
  const editorRoot = useEditorDOMElement(editor);
  const [filter, setFilter] = useState<CommentFilter>("open");
  const sort: CommentSort = "position";

  const listRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const threads = visibleThreads([...threadMap.values()], filter, sort, positions);

  // Doc → rail: when a thread is selected in the document (e.g. the user clicked
  // its highlighted text), scroll the matching card into view in the rail.
  useLayoutEffect(() => {
    if (!selectedThreadId) return;
    const card = cardRefs.current.get(selectedThreadId);
    card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedThreadId]);

  // Rail → doc: select the thread (BlockNote scrolls the editor to its anchor),
  // then flash the anchored text so the connection is unmistakable.
  const jumpToThread = (thread: ThreadData) => {
    const ext = getCommentsExtension(editor);
    ext?.selectThread(thread.id, true);
    flashAnchor(editorRoot, thread.id);
  };

  // Resolve / reopen — surfaced as an always-visible control on each card
  // because BlockNote only mounts its own resolve action on hover, which is
  // both hard to discover and unreachable on touch devices.
  const toggleResolved = (thread: ThreadData) => {
    const store = getCommentsExtension(editor)?.threadStore;
    if (!store) return;
    void (thread.resolved
      ? store.unresolveThread({ threadId: thread.id })
      : store.resolveThread({ threadId: thread.id }));
  };

  return (
    <div className="flex h-full w-full min-w-0 flex-col min-h-0">
      <div className="flex items-center gap-1 px-3 py-2 border-b shrink-0">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            aria-pressed={filter === f.value}
            className={cn(
              "rounded-md px-2 py-1 text-xs transition-colors",
              filter === f.value
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
        {showClose && (
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            aria-label="Close comments"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 py-2"
      >
        {threads.length === 0 ? (
          <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 px-4 text-center animate-fade-in">
            <MessageSquare className="h-6 w-6 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {filter === "resolved"
                ? "No resolved comments"
                : filter === "open"
                  ? "No open comments"
                  : "No comments yet"}
            </p>
            {filter !== "resolved" && (
              <p className="text-xs text-muted-foreground/70">
                Select text in the document and choose “Comment” to start a
                thread.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {threads.map((thread) => {
              const isSelected = thread.id === selectedThreadId;
              const auth = getCommentsExtension(editor)?.threadStore.auth;
              const canToggleResolved = thread.resolved
                ? (auth?.canUnresolveThread(thread) ?? false)
                : (auth?.canResolveThread(thread) ?? false);
              return (
                <div
                  key={thread.id}
                  ref={(el) => {
                    if (el) cardRefs.current.set(thread.id, el);
                    else cardRefs.current.delete(thread.id);
                  }}
                  onClick={() => jumpToThread(thread)}
                  className={cn(
                    "bn-comment-rail-card min-w-0 overflow-hidden rounded-lg border bg-card p-1 transition-colors cursor-pointer",
                    isSelected
                      ? "border-ring ring-1 ring-ring/40"
                      : "border-border hover:border-ring/40",
                  )}
                >
                  {canToggleResolved && (
                    <div className="flex justify-end px-1 pt-0.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleResolved(thread);
                        }}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors",
                          thread.resolved
                            ? "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                        title={thread.resolved ? "Reopen thread" : "Mark resolved"}
                      >
                        {thread.resolved ? (
                          <>
                            <Undo2 className="size-3" />
                            Reopen
                          </>
                        ) : (
                          <>
                            <Check className="size-3" />
                            Resolve
                          </>
                        )}
                      </button>
                    </div>
                  )}
                  <Thread
                    thread={thread}
                    selected={isSelected}
                    referenceText={getReferenceText(
                      editor,
                      positions.get(thread.id),
                    )}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Desktop docked rail (resizable) ---------------------------------------

const MIN_WIDTH = 280;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 340;
const WIDTH_STORAGE_KEY = "ripple:comments-rail-width";

function readStoredWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isNaN(parsed)) return DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed));
}

/** Desktop: a docked, resizable column that pushes the editor when open. */
export function CommentsDockedRail({ editor }: { editor: AnyEditor }) {
  const { open, setOpen } = useCommentsUI();
  const [width, setWidth] = useState(readStoredWidth);
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(width);

  // Window-level drag listeners live for the duration of a drag (keyed on the
  // `dragging` flag, which a mousedown on the handle flips on). Persisting the
  // final width and clearing the body cursor both happen in cleanup, so they
  // run exactly once when the drag ends or the rail unmounts mid-drag.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      // Rail is docked on the right: width grows as the pointer moves left.
      const next = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, window.innerWidth - e.clientX),
      );
      widthRef.current = next;
      setWidth(next);
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(widthRef.current));
    };
  }, [dragging]);

  if (!open) return null;

  return (
    <div
      className="relative flex h-full shrink-0 border-l bg-background animate-fade-in"
      style={{ width }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        className="absolute left-0 top-0 z-10 h-full w-1 -translate-x-1/2 cursor-col-resize hover:bg-ring/40 transition-colors"
      />
      <CommentsRailContent
        editor={editor}
        onClose={() => setOpen(false)}
        showClose
      />
    </div>
  );
}

// --- Mobile drawer ----------------------------------------------------------

/** Mobile: the rail content in a bottom sheet. */
export function CommentsDrawer({ editor }: { editor: AnyEditor }) {
  const { open, setOpen } = useCommentsUI();
  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="sr-only">
          <DrawerTitle>Comments</DrawerTitle>
        </DrawerHeader>
        <div className="h-[75vh] min-h-0">
          <CommentsRailContent
            editor={editor}
            onClose={() => setOpen(false)}
            showClose={false}
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
