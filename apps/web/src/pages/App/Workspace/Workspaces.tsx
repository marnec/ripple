import { useQuery } from "convex-helpers/react/cache";

import { RippleSpinner } from "@/components/RippleSpinner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { api } from "@convex/_generated/api";

export const Workspaces = () => {
  const workspaces = useQuery(api.workspaces.list);

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