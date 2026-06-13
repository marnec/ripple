import { Component, type ReactNode } from "react";

/**
 * Catches render-time errors so the app degrades to a recovery screen instead
 * of unmounting to a blank page. The main trigger here is Convex `useQuery`
 * throwing on a malformed route id (e.g. a hand-edited `#/users/<garbage>` hash
 * fails the `v.id(...)` arg validator) — without a boundary that blanks the SPA.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-lg font-semibold text-stone-100">Something went wrong</h1>
        <p className="max-w-sm font-mono text-xs text-stone-500">
          {this.state.error.message.split("\n")[0]}
        </p>
        <button
          onClick={() => {
            this.setState({ error: null });
            window.location.hash = "/";
          }}
          className="rounded-md border border-stone-700 px-3 py-1.5 text-sm text-stone-200 hover:bg-stone-800"
        >
          Back to overview
        </button>
      </div>
    );
  }
}
