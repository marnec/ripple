import React from "react";
import { useQuery } from "convex/react";

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { api } from "../../../../convex/_generated/api";

export const Workspaces = () => {
  const workspaces = useQuery(api.workspaces.list);

  if (workspaces === undefined) {
    return <LoadingSpinner />;
  }

  return (
    <div className="p-4">
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