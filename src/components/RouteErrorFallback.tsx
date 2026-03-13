import { AlertTriangle } from "lucide-react";
import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router-dom";

export function RouteErrorFallback() {
  const error = useRouteError();
  const navigate = useNavigate();

  const is404 = isRouteErrorResponse(error) && error.status === 404;

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <AlertTriangle className="h-12 w-12 text-muted-foreground mb-4" />
      <h2 className="text-xl font-semibold mb-2">
        {is404 ? "Page not found" : "Something went wrong"}
      </h2>
      <p className="text-muted-foreground mb-6 max-w-md">
        {is404
          ? "The page you're looking for doesn't exist or has been moved."
          : "An unexpected error occurred. You can try again or go back."}
      </p>
      <div className="flex gap-3">
        <button
          onClick={() => void navigate(-1)}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
        >
          Go back
        </button>
        <button
          onClick={() => void navigate(0)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
