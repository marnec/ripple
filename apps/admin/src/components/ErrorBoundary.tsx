import { Button } from "@/components/ui/button";
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
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="max-w-sm font-mono text-xs text-muted-foreground">
          {this.state.error.message.split("\n")[0]}
        </p>
        <Button
          variant="outline"
          onClick={() => {
            this.setState({ error: null });
            window.location.hash = "/";
          }}
        >
          Back to overview
        </Button>
      </div>
    );
  }
}
