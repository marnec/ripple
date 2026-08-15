import { useQuery } from "convex-helpers/react/cache";
import { useEffect } from "react";
import { toast } from "sonner";

import { RippleSpinner } from "@/components/RippleSpinner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ripple/ui/components/card";
import { Link } from "react-router-dom";
import { api } from "@convex/_generated/api";
import {
  INTEGRATION_CALLBACK_PARAMS,
  readIntegrationCallbackNotice,
} from "@/lib/integration-callback-notice";

export const Workspaces = () => {
  const workspaces = useQuery(api.workspaces.list);

  // A failed provider install redirects here. Without this the user comes back
  // from github.com/gitlab.com to a plain workspace list and is never told the
  // install did not complete.
  useEffect(() => {
    const notice = readIntegrationCallbackNotice(window.location.search);
    if (!notice) return;
    if (notice.variant === "success") toast.success(notice.title);
    else toast.error(notice.title, { description: notice.description });

    const params = new URLSearchParams(window.location.search);
    for (const key of INTEGRATION_CALLBACK_PARAMS) params.delete(key);
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
  }, []);

  if (workspaces === undefined) {
    return <RippleSpinner />;
  }

  return (
    <div className="p-4 animate-fade-in">
      <h1 className="text-2xl font-bold mb-4">Workspaces</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {workspaces.map((workspace) => (
          <Link to={`/workspaces/${workspace._id}`} key={workspace._id}>
            <Card className="h-full transition-all duration-200 ease-in-out hover:shadow-xl hover:-translate-y-1">
              <CardHeader>
                <CardTitle>{workspace.name}</CardTitle>
                {workspace.description && (
                  <CardDescription>{workspace.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent>                
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}; 